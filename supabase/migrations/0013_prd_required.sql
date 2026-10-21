-- =====================================================================
-- 0013: PRD 필수 항목 보완
--   §14  알림 시나리오 전체 (신청·결제·재배치·실패·이동·환불·다음 모집·피드백 미응답 1회)
--   INF-08 발송 실패 재시도 → 3회 실패 시 처리대기함
--   §11  운영자 화면용: 회차·식당 생성 권한, 처리 현황 집계, 테이블 상세(7.2) 정보
--   §16  회원 탈퇴(개인정보 삭제)
-- 다시 실행해도 안전
-- =====================================================================

-- ---------------------------------------------------------------------
-- §14 신청 상태가 바뀔 때마다 참가자 알림 예약 (커밋 시점에 실행 → 희망 회차까지 반영)
-- ---------------------------------------------------------------------
create or replace function app_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s record; pay payments%rowtype; t text; key text;
  add_noti text[] := '{}';
begin
  select e.starts_at, e.region_code, e.match_run_at, e.apply_deadline into s
    from application_slots x join event_slots e on e.id = x.slot_id
   where x.application_id = new.id order by e.starts_at limit 1;
  select * into pay from payments where application_id = new.id order by created_at desc limit 1;

  if new.application_status = 'SUBMITTED' and (tg_op = 'INSERT' or old.application_status is distinct from 'SUBMITTED') then
    add_noti := add_noti || 'APPLIED'::text;
    if new.payment_status = 'PENDING' then add_noti := add_noti || 'PAYMENT_PENDING'::text; end if;
  end if;
  if new.payment_status = 'PAID' and (tg_op = 'INSERT' or old.payment_status is distinct from 'PAID') then
    add_noti := add_noti || 'PAID'::text;
  end if;
  if tg_op = 'UPDATE' then
    if new.match_status = 'REALLOCATING' and old.match_status is distinct from 'REALLOCATING' then
      add_noti := add_noti || 'REALLOCATING'::text;
    end if;
    if new.match_status = 'ALTERNATIVE_OFFERED' and old.match_status is distinct from 'ALTERNATIVE_OFFERED' then
      add_noti := add_noti || 'MATCH_FAILED'::text;
    end if;
    if old.match_status = 'ALTERNATIVE_OFFERED' and new.match_status in ('WAITING', 'TRANSFERRED') then
      add_noti := add_noti || 'MOVED'::text;
    end if;
    if new.payment_status in ('REFUND_REQUESTED', 'REFUND_PROCESSING')
       and old.payment_status not in ('REFUND_REQUESTED', 'REFUND_PROCESSING', 'REFUNDED') then
      add_noti := add_noti || 'REFUND_REQUESTED'::text;
    end if;
    if new.payment_status = 'REFUNDED' and old.payment_status is distinct from 'REFUNDED' then
      add_noti := add_noti || 'REFUNDED'::text;
    end if;
  end if;

  foreach t in array add_noti loop
    key := t || ':' || new.id || case when t = 'MOVED' then ':' || coalesce(s.starts_at::text, '') else '' end;
    insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
    values (new.user_id, t,
            jsonb_build_object('application_id', new.id, 'starts_at', s.starts_at, 'region', s.region_code,
                               'match_run_at', s.match_run_at, 'deadline', s.apply_deadline,
                               'amount', coalesce(pay.refund_amount, pay.amount)),
            now(), key)
    on conflict (dedupe_key) do nothing;
  end loop;
  return null;
end $$;

drop trigger if exists trg_app_notify on applications;
create constraint trigger trg_app_notify after insert or update on applications
deferrable initially deferred
for each row execute function app_notify();

-- §14 다음 모집 시작: 새 회차가 열리면, 그 지역에서 모임에 참여했던 사람에게 날짜별 1회 추천
create or replace function next_recruit_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_open then
    insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
    select distinct m.user_id, 'NEXT_RECRUIT',
           jsonb_build_object('starts_at', new.starts_at, 'region', new.region_code, 'deadline', new.apply_deadline),
           now(), 'NEXT_RECRUIT:' || (new.starts_at at time zone 'Asia/Seoul')::date || ':' || m.user_id
      from table_members m join dining_tables t on t.id = m.table_id join event_slots e on e.id = t.slot_id
     where t.status = 'CONFIRMED' and e.region_code = new.region_code and e.starts_at < new.starts_at
       and m.attendance in ('ATTENDED', 'SCHEDULED')
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_next_recruit on event_slots;
create trigger trg_next_recruit after insert on event_slots
for each row execute function next_recruit_notify();

-- §15 피드백 미응답: 요청 하루 뒤 1회만 다시 알림 (이미 냈으면 보내지 않음)
create or replace function feedback_remind_schedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.template = 'FEEDBACK_REQUEST' then
    insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
    values (new.user_id, 'FEEDBACK_REMINDER', new.payload, new.scheduled_at + interval '1 day',
            'FEEDBACK_REMINDER:' || (new.payload->>'table_id') || ':' || new.user_id)
    on conflict (dedupe_key) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_feedback_remind on notifications;
create trigger trg_feedback_remind after insert on notifications
for each row execute function feedback_remind_schedule();

insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
select user_id, 'FEEDBACK_REMINDER', payload, scheduled_at + interval '1 day',
       'FEEDBACK_REMINDER:' || (payload->>'table_id') || ':' || user_id
  from notifications where template = 'FEEDBACK_REQUEST'
on conflict (dedupe_key) do nothing;

-- ---------------------------------------------------------------------
-- 알림 발송 (pg_cron 5분마다) — 0012 + INF-08 재시도
--   단체방이 없어 리마인드를 못 올리면 실패로 기록하고 다음 실행 때 다시 시도
--   3번 실패하면 처리대기함(NOTIFY)으로
-- ---------------------------------------------------------------------
create or replace function deliver_notifications() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  -- 피드백을 이미 냈으면 미응답 알림은 보내지 않음
  delete from notifications nt
   where nt.template = 'FEEDBACK_REMINDER' and nt.sent_at is null and nt.scheduled_at <= now()
     and exists (select 1 from feedback f where f.table_id = (nt.payload->>'table_id')::uuid and f.user_id = nt.user_id);

  -- 단체방이 없는 리마인드 = 발송 실패
  update notifications nt set attempts = attempts + 1, last_error = 'NO_CHAT_ROOM'
   where nt.sent_at is null and nt.scheduled_at <= now() and nt.template in ('REMINDER_D1', 'REMINDER_D0')
     and not exists (select 1 from chat_rooms c where c.table_id = (nt.payload->>'table_id')::uuid);

  insert into exception_cases(kind, table_id, reason)
  select distinct 'NOTIFY'::exception_kind, (nt.payload->>'table_id')::uuid, '리마인드 발송 3회 실패 (단체방 없음)'
    from notifications nt
   where nt.sent_at is null and nt.attempts >= 3 and nt.last_error is not null
     and not exists (select 1 from exception_cases e where e.kind = 'NOTIFY' and e.table_id = (nt.payload->>'table_id')::uuid);

  -- 전날·3시간 전 리마인드: 단체방에도 게시
  for r in select distinct (nt.payload->>'table_id')::uuid as table_id, nt.template
             from notifications nt
            where nt.sent_at is null and nt.scheduled_at <= now() and nt.template in ('REMINDER_D1', 'REMINDER_D0')
              and nt.last_error is null
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
   where sent_at is null and scheduled_at <= now() and last_error is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- §11 회차 관리·식당 재고: 운영자가 새로 만들 수 있게
-- ---------------------------------------------------------------------
drop policy if exists admin_slots_insert on event_slots;
create policy admin_slots_insert on event_slots for insert with check (is_admin());
drop policy if exists admin_venues_insert on venues;
create policy admin_venues_insert on venues for insert with check (is_admin());

-- 새 회차 + 그 지역 식당 수용 테이블 수를 한 번에
create or replace function admin_create_slot(p_starts timestamptz, p_region text, p_capacity int,
                                             p_deadline timestamptz, p_match_run timestamptz, p_tables_per_venue int default 2)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_deadline > p_starts or p_match_run < p_deadline then raise exception 'INVALID_SCHEDULE'; end if;
  insert into event_slots(region_code, starts_at, capacity, apply_deadline, match_run_at, is_open)
  values (p_region, p_starts, greatest(4, p_capacity), p_deadline, p_match_run, true)
  on conflict (region_code, starts_at) do update set capacity = excluded.capacity, apply_deadline = excluded.apply_deadline,
                                                     match_run_at = excluded.match_run_at
  returning id into v;
  insert into venue_availability(venue_id, slot_id, tables_total)
  select id, v, greatest(1, p_tables_per_venue) from venues where region_code = p_region and is_active
  on conflict (venue_id, slot_id) do nothing;
  return v;
end $$;
revoke all on function admin_create_slot(timestamptz, text, int, timestamptz, timestamptz, int) from public, anon;
grant execute on function admin_create_slot(timestamptz, text, int, timestamptz, timestamptz, int) to authenticated;

-- 식당 수용 테이블 수 (모집 중인 회차 전체에 적용)
create or replace function admin_set_venue_capacity(p_venue uuid, p_tables int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  insert into venue_availability(venue_id, slot_id, tables_total)
  select p_venue, e.id, greatest(1, p_tables) from event_slots e join venues v on v.region_code = e.region_code
   where v.id = p_venue and e.is_open
  on conflict (venue_id, slot_id) do update set tables_total = greatest(venue_availability.tables_used, excluded.tables_total);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function admin_set_venue_capacity(uuid, int) from public, anon;
grant execute on function admin_set_venue_capacity(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- §11 대시보드 "바로 보여야 하는 정보" 집계
-- ---------------------------------------------------------------------
create or replace function admin_issue_counts()
returns table(conflicts bigint, no_venue bigint, notify_failed bigint, refund_failed bigint,
              noshow_candidates bigint, late_cancels bigint, open_reports bigint, waiting_choice bigint,
              reallocated bigint, auto_confirmed bigint, match_failed bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from exception_cases where status = 'OPEN' and kind in ('CONFLICT', 'DATA')),
    (select count(*) from dining_tables t join event_slots s on s.id = t.slot_id
      where t.status = 'CONFIRMED' and t.venue_id is null and s.starts_at > now() - interval '1 day'),
    (select count(*) from notifications where sent_at is null and last_error is not null),
    (select count(*) from payments where status = 'REFUND_FAILED'),
    (select count(*) from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
      where t.status = 'CONFIRMED' and m.attendance = 'SCHEDULED' and m.checked_in_at is null
        and s.starts_at < now() and s.starts_at > now() - interval '7 days'),
    (select count(*) from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
      where m.attendance = 'CANCELED_LATE' and s.starts_at > now() - interval '7 days'),
    (select count(*) from safety_reports where status = 'OPEN'),
    (select count(*) from applications where match_status = 'ALTERNATIVE_OFFERED'),
    (select count(*) from table_members m join dining_tables t on t.id = m.table_id
      where t.status = 'CONFIRMED' and m.reallocation_count > 0),
    (select count(*) from dining_tables where status = 'CONFIRMED'),
    (select count(*) from applications where match_status in ('ALTERNATIVE_OFFERED', 'NO_MATCH'))
  where is_admin();
$$;
revoke all on function admin_issue_counts() from public, anon;
grant execute on function admin_issue_counts() to authenticated;

-- ---------------------------------------------------------------------
-- §7.2 테이블 상세: 참가자별 희망 일정 충족·이전 만남·차단/비선호 충돌·희망 동물 충족
-- ---------------------------------------------------------------------
create or replace function admin_table_detail(p_table uuid)
returns table(user_id uuid, name text, wanted_slot boolean, met_before int, conflict boolean,
              desired_met boolean, reallocation_count int, placement_reason text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.name,
         exists (select 1 from application_slots x where x.application_id = m.application_id and x.slot_id = t.slot_id),
         (select count(*)::int from table_members o join table_members o2 on o2.table_id = o.table_id
            join dining_tables ot on ot.id = o.table_id
           where o.user_id = m.user_id and o2.user_id <> m.user_id and ot.id <> t.id and ot.status = 'CONFIRMED'
             and o2.user_id in (select user_id from table_members where table_id = t.id)),
         exists (select 1 from table_members o where o.table_id = t.id and o.user_id <> m.user_id and (
                   exists (select 1 from blocks b where (b.blocker_id = m.user_id and b.blocked_id = o.user_id)
                                                      or (b.blocker_id = o.user_id and b.blocked_id = m.user_id))
                or exists (select 1 from person_preferences pp where pp.kind = 'AVOID'
                             and ((pp.from_user = m.user_id and pp.to_user = o.user_id) or (pp.from_user = o.user_id and pp.to_user = m.user_id))))),
         coalesce(array_length(p.desired_traits, 1), 0) = 0
           or exists (select 1 from table_members o join profiles op on op.id = o.user_id
                       where o.table_id = t.id and o.user_id <> m.user_id and op.self_traits && p.desired_traits),
         m.reallocation_count, m.placement_reason
    from table_members m join dining_tables t on t.id = m.table_id join profiles p on p.id = m.user_id
   where m.table_id = p_table and is_admin();
$$;
revoke all on function admin_table_detail(uuid) from public, anon;
grant execute on function admin_table_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- §16 회원 탈퇴: 개인정보는 지우고, 통계용 참석·피드백 기록만 익명으로 남김
--   다가오는 확정 모임이 있으면 먼저 취소해야 함
-- ---------------------------------------------------------------------
alter table profiles add column if not exists deleted_at timestamptz;

create or replace function delete_my_account() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := current_profile_id(); v_auth uuid := auth.uid();
begin
  if me is null then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
              where m.user_id = me and t.status = 'CONFIRMED' and m.attendance = 'SCHEDULED' and s.starts_at > now()) then
    raise exception 'HAS_UPCOMING_TABLE';
  end if;
  if exists (select 1 from applications where user_id = me and application_status = 'SUBMITTED'
              and payment_status = 'PAID' and match_status in ('WAITING', 'ALTERNATIVE_OFFERED')) then
    raise exception 'HAS_PENDING_APPLICATION';
  end if;
  perform set_config('app.actor', 'user:' || me, true);
  update applications set application_status = 'CANCELED'
   where user_id = me and application_status = 'SUBMITTED' and match_status in ('WAITING', 'ALTERNATIVE_OFFERED')
     and payment_status = 'PENDING';
  delete from region_waitlist where profile_id = me;
  update profiles set name = '탈퇴한 회원', phone = null, job = null, allergies = '{}', food_dislikes = '{}',
                      budget_ranges = '{}', auth_user_id = null, deleted_at = now()
   where id = me;
  delete from auth.users where id = v_auth;
  return 'DELETED';
end $$;
revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- §11 참석 관리: 노쇼 후보를 운영자가 확인 후 참석/노쇼로 확정 (노쇼면 벌점 규칙 적용)
-- ---------------------------------------------------------------------
create or replace function admin_set_attendance(p_table uuid, p_user uuid, p_status attendance_status) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_status not in ('ATTENDED', 'NO_SHOW') then raise exception 'INVALID_STATUS'; end if;
  perform set_config('app.actor', 'admin:' || current_profile_id(), true);
  update table_members set attendance = p_status,
         checked_in_at = case when p_status = 'ATTENDED' then coalesce(checked_in_at, now()) else checked_in_at end
   where table_id = p_table and user_id = p_user;
  if p_status = 'NO_SHOW' then perform apply_sanction(p_user); end if;
  return p_status::text;
end $$;
revoke all on function admin_set_attendance(uuid, uuid, attendance_status) from public, anon;
grant execute on function admin_set_attendance(uuid, uuid, attendance_status) to authenticated;

-- ---------------------------------------------------------------------
-- §11 자동 메시지 관리: 운영자가 고친 알림 문구 (참가자 알림 화면에서 읽음)
-- ---------------------------------------------------------------------
insert into settings(key, value) values ('message_overrides', '{}'::jsonb) on conflict (key) do nothing;

create or replace function message_overrides() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from settings where key = 'message_overrides'), '{}'::jsonb);
$$;
grant execute on function message_overrides() to authenticated;

-- 템플릿별 발송 현황
create or replace function admin_message_stats()
returns table(template text, total bigint, sent bigint, pending bigint, failed bigint, last_sent timestamptz)
language sql stable security definer set search_path = public as $$
  select template, count(*), count(sent_at), count(*) filter (where sent_at is null and last_error is null),
         count(*) filter (where sent_at is null and last_error is not null), max(sent_at)
    from notifications where is_admin() group by template;
$$;
revoke all on function admin_message_stats() from public, anon;
grant execute on function admin_message_stats() to authenticated;

create or replace function admin_chat_stats()
returns table(kind text, total bigint, rooms bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select kind, count(*), count(distinct room_id), max(created_at)
    from chat_messages where sender_id is null and is_admin() group by kind;
$$;
revoke all on function admin_chat_stats() from public, anon;
grant execute on function admin_chat_stats() to authenticated;
