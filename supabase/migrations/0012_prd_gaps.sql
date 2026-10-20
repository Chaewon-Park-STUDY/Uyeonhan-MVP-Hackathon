-- =====================================================================
-- 0012: PRD P0 보완 (제출 전 점검)
--   INF-05 단체방 자동 공지에 취소 정책
--   INF-07 전날 리마인드에 시간·장소·예약명·취소 정책
--   CON-03 모임 시작 시각에 아이스브레이킹 게임 + 대화 주제 자동 게시
--   INF-03 식당 가격대 표시용 (table_info 에 price_range)
--   SAF-02 신고 검토 → 경고 / 30일 참가 제한 / 영구 제한 기록
-- 다시 실행해도 안전
-- =====================================================================

-- ---------------------------------------------------------------------
-- INF-05: 대화 주제(TOPIC) 안내가 처음 올라가면 바로 뒤에 취소 정책 공지
-- ---------------------------------------------------------------------
create or replace function policy_notice_text() returns text
language sql immutable as $$
  select E'📌 참석 안내\n· 매칭이 확정된 뒤에는 환불되지 않아요 (화요일 24:00 이후)\n'
      || E'· 못 오게 되면 앱 테이블 화면의 "못 가게 됐나요?"로 꼭 알려 주세요\n'
      || E'· 당일 취소 0.5점, 노쇼 1점 — 90일 안에 2점이면 30일간 신청이 제한돼요\n'
      || E'· 불편한 일이 있으면 피드백 화면에서 비공개로 신고할 수 있어요';
$$;

create or replace function add_policy_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender_id is null and new.kind = 'TOPIC'
     and not exists (select 1 from chat_messages where room_id = new.room_id and kind = 'POLICY') then
    insert into chat_messages(room_id, kind, content) values (new.room_id, 'POLICY', policy_notice_text());
  end if;
  return new;
end $$;

drop trigger if exists trg_policy_notice on chat_messages;
create trigger trg_policy_notice after insert on chat_messages
for each row execute function add_policy_notice();

-- 이미 만들어진 단체방에도 한 번 게시
insert into chat_messages(room_id, kind, content)
select c.id, 'POLICY', policy_notice_text() from chat_rooms c
 where not exists (select 1 from chat_messages m where m.room_id = c.id and m.kind = 'POLICY');

-- ---------------------------------------------------------------------
-- INF-07 + CON-03: 알림 발송 (pg_cron 5분마다)
-- ---------------------------------------------------------------------
create or replace function icebreak_text(p_table uuid) returns text
language sql stable security definer set search_path = public as $$
  select E'🎲 오늘의 아이스브레이킹\n'
      || E'1) 동물 카드 맞히기 — 자기소개 전에 서로의 "닮은 동물"을 맞혀 보세요. 정답은 앱 테이블 소개에 있어요.\n'
      || E'2) 공통점 3개 찾기 — 테이블 모두에게 해당하는 공통점 3개를 먼저 찾는 사람이 건배사!\n'
      || E'3) 두 개의 진실, 하나의 거짓 — 나에 대한 문장 3개 중 거짓을 맞혀 보세요.\n\n'
      || E'💬 이런 이야기도 좋아요\n· '
      || array_to_string(template_topics(
           array(select jsonb_array_elements_text(coalesce(t.explanation->'shared_interests', '[]'))),
           p_table::text || ':start'), E'\n· ')
    from dining_tables t where t.id = p_table;
$$;

create or replace function deliver_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  -- 전날·3시간 전 리마인드: 단체방에도 게시
  for r in select distinct (nt.payload->>'table_id')::uuid as table_id, nt.template
             from notifications nt
            where nt.sent_at is null and nt.scheduled_at <= now() and nt.template in ('REMINDER_D1', 'REMINDER_D0')
  loop
    insert into chat_messages(room_id, kind, content)
    select c.id, 'REMINDER',
           case r.template
             when 'REMINDER_D1' then
               '내일 저녁 만나요! ⏰ ' || to_char(s.starts_at at time zone 'Asia/Seoul', 'FMMM"/"FMDD HH24:MI')
               || coalesce(E'\n📍 ' || v.name || ' (' || v.address || ')', '')
               || E'\n🪑 예약명 "우연한 식탁"'
               || E'\n못 오게 되면 오늘 중에 앱에서 알려 주세요. 당일 취소는 환불이 안 되고 벌점 0.5점, 노쇼는 1점이에요.'
             else '오늘 저녁 모임이 3시간 남았어요.' || coalesce(' 📍 ' || v.name, '') || E'\n위치를 한 번 더 확인해 주세요. 조심히 오세요!' end
      from chat_rooms c join dining_tables t on t.id = c.table_id join event_slots s on s.id = t.slot_id
      left join venues v on v.id = t.venue_id
     where c.table_id = r.table_id;
  end loop;

  -- 모임 시작 시각: 아이스브레이킹 + 대화 주제 (CON-03), 방마다 한 번
  insert into chat_messages(room_id, kind, content)
  select c.id, 'GAME', icebreak_text(t.id)
    from chat_rooms c join dining_tables t on t.id = c.table_id join event_slots s on s.id = t.slot_id
   where t.status = 'CONFIRMED' and now() between s.starts_at and s.starts_at + interval '3 hours'
     and not exists (select 1 from chat_messages m where m.room_id = c.id and m.kind = 'GAME');

  update notifications set sent_at = now(), attempts = attempts + 1
   where sent_at is null and scheduled_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- INF-03: 테이블 안내에 가격대
-- ---------------------------------------------------------------------
drop function if exists table_info(uuid);
create function table_info(p_table_id uuid)
returns table(starts_at timestamptz, region_code text, venue_name text, venue_address text, map_url text,
              room_id uuid, shared_interests jsonb, price_range text)
language sql stable security definer set search_path = public as $$
  select s.starts_at, s.region_code, v.name, v.address, v.map_url, c.id, t.explanation->'shared_interests', v.price_range
    from dining_tables t
    join event_slots s on s.id = t.slot_id
    left join venues v on v.id = t.venue_id
    left join chat_rooms c on c.table_id = t.id
   where t.id = p_table_id and t.status = 'CONFIRMED' and (is_table_member(p_table_id) or is_admin());
$$;
revoke all on function table_info(uuid) from public, anon;
grant execute on function table_info(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- SAF-02: 운영자 신고 조치 (예외함에서 호출)
--   WARNING   : 경고 기록
--   RESTRICTED: 30일 참가 제한
--   BANNED    : 영구 제한
--   DISMISSED : 조치 없음 (신고 내용 확인 결과 문제 없음)
-- ---------------------------------------------------------------------
create or replace function admin_safety_action(p_exception uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e exception_cases%rowtype; rep safety_reports%rowtype;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_action not in ('WARNING', 'RESTRICTED', 'BANNED', 'DISMISSED') then raise exception 'INVALID_ACTION'; end if;
  select * into e from exception_cases where id = p_exception and kind = 'SAFETY';
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  select * into rep from safety_reports where table_id = e.table_id and status = 'OPEN' order by created_at desc limit 1;

  perform set_config('app.actor', 'admin:' || current_profile_id(), true);
  if rep.id is not null then
    update safety_reports set status = 'RESOLVED', admin_action = p_action where id = rep.id;
    if p_action = 'RESTRICTED' then
      update profiles set restricted_until = greatest(coalesce(restricted_until, now()), now() + interval '30 days') where id = rep.reported_id;
    elsif p_action = 'BANNED' then
      update profiles set restricted_until = 'infinity' where id = rep.reported_id;
    end if;
  end if;
  update exception_cases
     set status = 'RESOLVED', resolved_at = now(),
         admin_note = case p_action when 'WARNING' then '경고' when 'RESTRICTED' then '30일 참가 제한'
                                    when 'BANNED' then '영구 제한' else '조치 없음' end
                      || coalesce(' · ' || nullif(trim(p_note), ''), '')
   where id = e.id;
  return p_action;
end $$;
revoke all on function admin_safety_action(uuid, text, text) from public, anon;
grant execute on function admin_safety_action(uuid, text, text) to authenticated;

-- 운영자 화면: 신고 대상 확인용
create or replace function admin_safety_detail(p_exception uuid)
returns table(reporter text, reported text, reason text, reported_restricted_until timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.name, pd.name, r.reason, pd.restricted_until
    from exception_cases e
    join safety_reports r on r.table_id = e.table_id
    join profiles pr on pr.id = r.reporter_id
    join profiles pd on pd.id = r.reported_id
   where e.id = p_exception and e.kind = 'SAFETY' and is_admin()
   order by r.created_at desc limit 1;
$$;
revoke all on function admin_safety_detail(uuid) from public, anon;
grant execute on function admin_safety_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- FDB-03: 재참여 의향·추천 의향 (피드백 제출 직후 본인 행에 기록)
-- ---------------------------------------------------------------------
create or replace function set_feedback_intents(p_table uuid, p_revisit int, p_recommend int) returns void
language sql security definer set search_path = public as $$
  update feedback
     set revisit_intent = case when p_revisit between 1 and 5 then p_revisit end,
         recommend_intent = case when p_recommend between 1 and 5 then p_recommend end
   where table_id = p_table and user_id = current_profile_id();
$$;
revoke all on function set_feedback_intents(uuid, int, int) from public, anon;
grant execute on function set_feedback_intents(uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 운영 대시보드 지도: 모임일별 지역 신청 수·확정 테이블 수
--   신청 수 = 그 지역 회차를 희망한 신청서 수 (여러 지역을 고르면 각 지역에 셈)
-- ---------------------------------------------------------------------
create or replace function admin_region_stats(p_date date)
returns table(region_code text, label text, apps bigint, tables bigint)
language sql stable security definer set search_path = public as $$
  select r.code, r.name,
         (select count(distinct a.id) from applications a
            join application_slots s on s.application_id = a.id join event_slots e on e.id = s.slot_id
           where a.application_status = 'SUBMITTED' and e.region_code = r.code
             and (e.starts_at at time zone 'Asia/Seoul')::date = p_date),
         (select count(*) from dining_tables t join event_slots e on e.id = t.slot_id
           where t.status = 'CONFIRMED' and e.region_code = r.code
             and (e.starts_at at time zone 'Asia/Seoul')::date = p_date)
    from regions r
   where is_admin()
   order by r.code;
$$;
revoke all on function admin_region_stats(date) from public, anon;
grant execute on function admin_region_stats(date) to authenticated;
