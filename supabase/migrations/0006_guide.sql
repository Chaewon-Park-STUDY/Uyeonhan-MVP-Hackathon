-- =====================================================================
-- 0006: 모임 안내 자동화 (A4 · PRD 8장 INF-01~08)
--   테이블이 확정되는 순간(트리거) 아래가 자동으로 일어난다. 운영자 손이 필요 없다.
--   1) 식당 자동 배정 : 회차·지역에 자리가 남은 식당 중
--                       알레르기 메뉴가 있는 곳은 제외(필수), 비선호 음식이 겹치는 만큼 감점, 평점 높은 순
--                       배정할 곳이 없으면 운영자 예외함(VENUE)으로
--   2) 단체방 생성    : 테이블당 1개 + 환영 / 식당 안내 / 매칭 이유 / 대화 주제 메시지
--   3) 알림 예약      : 확정(즉시) · 전날 리마인드 · 당일 3시간 전 · 식사 후 피드백 요청
--   4) 알림 발송      : deliver_notifications() 를 pg_cron 이 5분마다 실행 → 앱 알림 + 단체방 리마인드
-- 다시 실행해도 안전
-- =====================================================================

-- ---------------------------------------------------------------------
-- 알레르기 → 피해야 할 메뉴 태그 (갑각류 알레르기는 해산물 식당도 피함)
-- ---------------------------------------------------------------------
create or replace function allergy_tags(p_allergies text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select unnest(p_allergies) as t
    union all
    select '해산물' where '갑각류' = any(p_allergies)
  ) s where t not like '기타:%';
$$;

-- ---------------------------------------------------------------------
-- 1) 식당 자동 배정
-- ---------------------------------------------------------------------
create or replace function assign_venue(p_table uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  t dining_tables%rowtype; v_region text; v_avoid text[]; v_dislike text[]; v_venue uuid; v_reason text;
begin
  select * into t from dining_tables where id = p_table;
  if t.venue_id is not null then return t.venue_id; end if;
  select region_code into v_region from event_slots where id = t.slot_id;

  select coalesce(array_agg(distinct x), '{}') into v_avoid
    from table_members m join profiles p on p.id = m.user_id, unnest(allergy_tags(p.allergies)) x
   where m.table_id = p_table;
  select coalesce(array_agg(x), '{}') into v_dislike            -- 중복 유지: 여러 명이 싫어하면 더 큰 감점
    from table_members m join profiles p on p.id = m.user_id, unnest(p.food_dislikes) x
   where m.table_id = p_table and x not like '기타:%';

  select v.id into v_venue
    from venues v join venue_availability va on va.venue_id = v.id and va.slot_id = t.slot_id
   where v.region_code = v_region and v.is_active and v.is_reservable
     and va.tables_used < va.tables_total
     and not (v.menu_tags && v_avoid)
   order by (select count(*) from unnest(v_dislike) d where d = any(v.menu_tags)),   -- 비선호 겹침 적은 순
            v.rating desc nulls last,
            va.tables_total - va.tables_used desc
   limit 1
   for update of va;

  if v_venue is null then
    v_reason := case when exists (select 1 from venue_availability va join venues v on v.id = va.venue_id
                                   where va.slot_id = t.slot_id and va.tables_used < va.tables_total)
                     then '알레르기 조건을 만족하는 식당 없음 (' || array_to_string(v_avoid, ', ') || ')'
                     else '남은 식당 자리 없음' end;
    insert into exception_cases(kind, reason)
    values ('VENUE', '식당 자동 배정 실패: ' || v_reason || ' / table ' || p_table);
    return null;
  end if;

  update venue_availability set tables_used = tables_used + 1 where venue_id = v_venue and slot_id = t.slot_id;
  update dining_tables set venue_id = v_venue where id = p_table;
  return v_venue;
end $$;

-- ---------------------------------------------------------------------
-- 대화 주제 (템플릿) — 공통 관심사 기반, Gemini 는 앱에서 추가로 요청 (실패해도 이 템플릿이 있음)
-- ---------------------------------------------------------------------
create or replace function template_topics(p_interests text[], p_seed text) returns text[]
language sql immutable as $$
  with bank(interest, q) as (values
    ('운동', '요즘 꾸준히 하고 있는 운동이 있나요? 시작하게 된 계기도 궁금해요.'),
    ('운동', '운동하고 나서 꼭 먹는 음식이 있다면?'),
    ('맛집·카페 탐방', '최근에 가본 곳 중 "여긴 또 간다" 싶었던 가게는?'),
    ('맛집·카페 탐방', '나만 알고 싶은 동네 단골집이 있나요?'),
    ('여행', '가장 기억에 남는 여행지와 그 이유는?'),
    ('여행', '다음 휴가에 딱 한 곳만 갈 수 있다면 어디로?'),
    ('영화·드라마', '최근에 끝까지 몰아본 작품이 있나요?'),
    ('영화·드라마', '인생 영화 한 편을 꼽는다면?'),
    ('음악', '요즘 플레이리스트에서 가장 많이 듣는 곡은?'),
    ('음악', '가봤던 공연 중 최고는 무엇이었나요?'),
    ('독서·글쓰기', '최근에 읽고 누군가에게 추천하고 싶었던 책은?'),
    ('독서·글쓰기', '책이나 글에서 오래 기억에 남은 한 문장이 있나요?'),
    ('자기계발·공부', '요즘 새로 배우고 있는 것이 있나요?'),
    ('자기계발·공부', '올해 안에 꼭 해보고 싶은 한 가지는?'),
    ('전시·공연·아트', '최근에 본 전시나 공연 중 인상 깊었던 것은?'),
    ('전시·공연·아트', '직접 해보고 싶은 예술 활동이 있나요?'),
    ('패션·뷰티', '요즘 가장 자주 손이 가는 아이템은?'),
    ('사진·영상', '최근에 찍은 사진 중 가장 마음에 드는 한 장은?'),
    ('', '오늘 이 자리에 오게 된 계기가 궁금해요.'),
    ('', '요즘 하루 중 가장 좋아하는 시간은 언제인가요?'),
    ('', '최근에 작게라도 기분 좋았던 일이 있나요?')
  )
  select array(
    select q from (
      select q, interest, row_number() over (partition by interest order by md5(p_seed || q)) rn
        from bank where interest = any(p_interests) or interest = ''
    ) s
    order by (interest = '') , rn, md5(p_seed || q)
    limit 3
  );
$$;

-- ---------------------------------------------------------------------
-- 2)+3) 확정된 테이블 안내 준비 (멱등)
-- ---------------------------------------------------------------------
create or replace function setup_table_guide(p_table uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t dining_tables%rowtype; s event_slots%rowtype; v venues%rowtype; v_room uuid; v_shared text[];
  v_when text; v_topics text[];
begin
  select * into t from dining_tables where id = p_table and status = 'CONFIRMED';
  if t.id is null then return; end if;
  select * into s from event_slots where id = t.slot_id;

  perform assign_venue(p_table);
  select * into t from dining_tables where id = p_table;
  select * into v from venues where id = t.venue_id;

  insert into chat_rooms(table_id) values (p_table) on conflict (table_id) do nothing;
  select id into v_room from chat_rooms where table_id = p_table;

  -- 안내 메시지는 방에 처음 한 번만
  if not exists (select 1 from chat_messages where room_id = v_room and sender_id is null) then
    v_when := to_char(s.starts_at at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" ') ||
              (array['일','월','화','수','목','금','토'])[extract(dow from s.starts_at at time zone 'Asia/Seoul')::int + 1] ||
              '요일 ' || to_char(s.starts_at at time zone 'Asia/Seoul', 'HH24:MI');
    v_shared := array(select jsonb_array_elements_text(coalesce(t.explanation->'shared_interests', '[]')));
    v_topics := template_topics(v_shared, p_table::text);

    insert into chat_messages(room_id, kind, content) values
      (v_room, 'NOTICE', '우연한 식탁에 오신 걸 환영해요! ' || v_when || '에 만나요. 자리에 앉기 전에 가볍게 인사 나눠 보세요.'),
      (v_room, 'NOTICE', case when v.id is null
         then '식당은 운영자가 확인 중이에요. 정해지면 바로 알려 드릴게요.'
         else '📍 ' || v.name || E'\n' || v.address || coalesce(E'\n' || v.map_url, '') ||
              E'\n예약은 "우연한 식탁" 이름으로 되어 있어요.' end),
      (v_room, 'CURATION', '이 테이블은 연령대·성비·MBTI 균형과 관심사를 함께 고려해 만들어졌어요.' ||
         case when cardinality(v_shared) > 0 then ' 여러 분이 「' || array_to_string(v_shared, '」 「') || '」에 관심이 있어요.' else '' end),
      (v_room, 'TOPIC', E'처음 만나 어색할 때 이런 이야기로 시작해 보세요\n· ' || array_to_string(v_topics, E'\n· '));
  end if;

  -- 알림 예약 (dedupe_key 로 중복 방지)
  insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
  select m.user_id, n.template,
         jsonb_build_object('table_id', p_table, 'starts_at', s.starts_at, 'venue', v.name, 'region', s.region_code),
         n.at, n.template || ':' || p_table || ':' || m.user_id
    from table_members m,
         (values ('MATCH_CONFIRMED', now()),
                 ('REMINDER_D1',     s.starts_at - interval '1 day'),
                 ('REMINDER_D0',     s.starts_at - interval '3 hours'),
                 ('FEEDBACK_REQUEST', s.starts_at + interval '3 hours')) n(template, at)
   where m.table_id = p_table
  on conflict (dedupe_key) do nothing;
end $$;

create or replace function on_table_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'CONFIRMED' and old.status is distinct from 'CONFIRMED' then
    perform setup_table_guide(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_table_guide on dining_tables;
create trigger trg_table_guide after update of status on dining_tables
for each row execute function on_table_confirmed();

-- ---------------------------------------------------------------------
-- 4) 알림 발송 (pg_cron 5분마다) — 시연에서는 앱 알림 + 단체방 메시지가 발송 채널
--    예약 시각이 지난 것만 보내고, sent_at 으로 한 번만 보낸다.
-- ---------------------------------------------------------------------
create or replace function deliver_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select distinct (payload->>'table_id')::uuid as table_id, template
             from notifications
            where sent_at is null and scheduled_at <= now() and template in ('REMINDER_D1', 'REMINDER_D0')
  loop
    insert into chat_messages(room_id, kind, content)
    select c.id, 'REMINDER',
           case r.template
             when 'REMINDER_D1' then '내일 저녁 만나요! 늦을 것 같으면 이 방에 미리 알려 주세요. 당일 취소는 환불이 안 되고 노쇼로 기록돼요.'
             else '오늘 저녁 모임이 3시간 남았어요. 식당 위치를 한 번 더 확인해 주세요. 조심히 오세요!' end
      from chat_rooms c where c.table_id = r.table_id;
  end loop;

  update notifications set sent_at = now(), attempts = attempts + 1
   where sent_at is null and scheduled_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 참가자 앱용 읽기 함수
-- ---------------------------------------------------------------------
-- 단체방 멤버 (메시지 보낸 사람 표시용: 이름 첫 글자만)
create or replace function table_roster(p_table_id uuid)
returns table(profile_id uuid, nickname text, is_me boolean)
language sql stable security definer set search_path = public as $$
  select p.id, left(p.name, 1) || '○○', p.id = current_profile_id()
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id and (is_table_member(p_table_id) or is_admin());
$$;

-- 테이블 안내 카드 (회차·식당)
create or replace function table_info(p_table_id uuid)
returns table(starts_at timestamptz, region_code text, venue_name text, venue_address text, map_url text,
              room_id uuid, shared_interests jsonb)
language sql stable security definer set search_path = public as $$
  select s.starts_at, s.region_code, v.name, v.address, v.map_url, c.id, t.explanation->'shared_interests'
    from dining_tables t
    join event_slots s on s.id = t.slot_id
    left join venues v on v.id = t.venue_id
    left join chat_rooms c on c.table_id = t.id
   where t.id = p_table_id and t.status = 'CONFIRMED' and (is_table_member(p_table_id) or is_admin());
$$;

-- 알림 읽음 표시용 컬럼
alter table notifications add column if not exists read_at timestamptz;
create or replace function mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = current_profile_id() and sent_at is not null and read_at is null;
$$;

-- 실시간 단체방 (Supabase Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;

-- 이미 확정된 테이블(10/22 등)도 지금 안내 준비
select setup_table_guide(id) from dining_tables where status = 'CONFIRMED';

-- 5분마다 발송 (pg_cron 있는 환경에서만)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'deliver-notifications';
    perform cron.schedule('deliver-notifications', '*/5 * * * *', 'select deliver_notifications()');
  end if;
end $$;

revoke all on function assign_venue(uuid), setup_table_guide(uuid), on_table_confirmed(), deliver_notifications()
  from public, anon, authenticated;
revoke all on function table_roster(uuid), table_info(uuid), mark_notifications_read() from public, anon;
grant execute on function table_roster(uuid), table_info(uuid), mark_notifications_read() to authenticated;
