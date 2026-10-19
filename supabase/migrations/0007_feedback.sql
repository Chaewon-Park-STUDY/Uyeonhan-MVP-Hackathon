-- =====================================================================
-- 0007: 모임 후 피드백 · 참석 · 노쇼 (A5 · PRD 9장 FB-01~08)
--   1) 체크인        : 모임 1시간 전 ~ 3시간 후 "도착했어요"
--   2) 좌석 취소     : 확정 후 취소 = 환불 0% (화 24:00 이후), 당일 취소는 제재 0.5점
--   3) 피드백 제출   : 만족도(학습 신호) · 대화 · 식당 / 함께한 사람별 또 만나고 싶어요·다시는 X·안 왔어요
--                      신고(→ 차단 + 운영자 예외함) / 제출 즉시 재방문 쿠폰 10% (14일)
--   4) 참석 확정     : 모임 24시간 뒤 자동. 체크인·피드백 = 참석, "안 왔어요" 표가 과반이면 노쇼
--                      노쇼 1점 · 당일취소 0.5점, 90일 내 2점 → 30일 신청 제한
--   5) 학습          : 테이블 만족도 평균 → /api/learn 이 베이지안 사후분포 갱신 (model_snapshots)
-- 다시 실행해도 안전
-- =====================================================================

-- 시연 모드: 모임 전에도 체크인·피드백 가능 (심사용). 운영 시 false
insert into settings(key, value) values ('demo', '{"feedback_anytime": true}')
on conflict (key) do nothing;

create or replace function demo_mode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'feedback_anytime')::boolean from settings where key = 'demo'), false);
$$;

-- "안 왔어요" 표 (참석 확정용, 비공개)
create table if not exists attendance_votes (
  table_id   uuid references dining_tables(id) on delete cascade,
  voter_id   uuid references profiles(id),
  target_id  uuid references profiles(id),
  created_at timestamptz not null default now(),
  primary key (table_id, voter_id, target_id)
);
alter table attendance_votes enable row level security;
drop policy if exists admin_votes on attendance_votes;
create policy admin_votes on attendance_votes for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- 내 테이블 상태 (화면용)
-- ---------------------------------------------------------------------
create or replace function my_table_status(p_table uuid)
returns table(attendance attendance_status, checked_in_at timestamptz, can_check_in boolean,
              can_cancel boolean, can_feedback boolean, feedback_done boolean, demo boolean)
language sql stable security definer set search_path = public as $$
  select m.attendance, m.checked_in_at,
         m.attendance = 'SCHEDULED' and m.checked_in_at is null
           and (demo_mode() or now() between s.starts_at - interval '1 hour' and s.starts_at + interval '3 hours'),
         m.attendance = 'SCHEDULED' and m.checked_in_at is null and now() < s.starts_at,
         m.attendance in ('SCHEDULED', 'ATTENDED') and (demo_mode() or now() >= s.starts_at),
         exists (select 1 from feedback f where f.table_id = p_table and f.user_id = m.user_id),
         demo_mode()
    from table_members m
    join dining_tables t on t.id = m.table_id
    join event_slots s on s.id = t.slot_id
   where m.table_id = p_table and m.user_id = current_profile_id();
$$;

-- ---------------------------------------------------------------------
-- 1) 체크인
-- ---------------------------------------------------------------------
create or replace function check_in(p_table uuid) returns text
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  select * into st from my_table_status(p_table);
  if not found then raise exception 'NOT_FOUND'; end if;
  if not st.can_check_in then raise exception 'CHECKIN_CLOSED'; end if;
  update table_members set checked_in_at = now(), attendance = 'ATTENDED'
   where table_id = p_table and user_id = current_profile_id();
  insert into chat_messages(room_id, kind, content)
  select c.id, 'NOTICE', (select left(name, 1) || '○○' from profiles where id = current_profile_id()) || '님이 도착했어요 👋'
    from chat_rooms c where c.table_id = p_table;
  return 'CHECKED_IN';
end $$;

-- ---------------------------------------------------------------------
-- 벌점 → 신청 제한 (90일 내 2점 이상 → 30일)
-- ---------------------------------------------------------------------
create or replace function apply_sanction(p_user uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := (select value from settings where key = 'no_show_sanction');
  pts numeric;
begin
  select coalesce(sum(case m.attendance when 'NO_SHOW' then (cfg->>'no_show_point')::numeric
                                         when 'CANCELED_LATE' then (cfg->>'late_cancel_point')::numeric
                                         else 0 end), 0)
    into pts
    from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
   where m.user_id = p_user
     and s.starts_at > now() - make_interval(days => (cfg->>'window_days')::int);
  if pts >= (cfg->>'threshold')::numeric then
    update profiles set restricted_until = greatest(coalesce(restricted_until, now()),
                                                    now() + make_interval(days => (cfg->>'restrict_days')::int))
     where id = p_user;
  end if;
  return pts;
end $$;

-- ---------------------------------------------------------------------
-- 2) 확정 후 좌석 취소 (확정은 화 24:00 = 환불 마감 이후이므로 환불 0%)
-- ---------------------------------------------------------------------
create or replace function cancel_my_seat(p_table uuid) returns text
language plpgsql security definer set search_path = public as $$
declare st record; v_start timestamptz; v_same_day boolean;
begin
  select * into st from my_table_status(p_table);
  if not found then raise exception 'NOT_FOUND'; end if;
  if not st.can_cancel then raise exception 'CANCEL_CLOSED'; end if;
  select s.starts_at into v_start from dining_tables t join event_slots s on s.id = t.slot_id where t.id = p_table;
  v_same_day := (now() at time zone 'Asia/Seoul')::date = (v_start at time zone 'Asia/Seoul')::date;

  perform set_config('app.actor', 'user:' || current_profile_id(), true);
  update table_members
     set attendance = case when v_same_day then 'CANCELED_LATE'::attendance_status else 'CANCELED_EARLY'::attendance_status end,
         canceled_at = now()
   where table_id = p_table and user_id = current_profile_id();
  insert into chat_messages(room_id, kind, content)
  select c.id, 'NOTICE', '한 분이 사정이 생겨 이번 모임에 참석하지 못하게 됐어요.'
    from chat_rooms c where c.table_id = p_table;
  -- 4명 미만이 되면 운영자 확인 (빈자리 충원·마감할인은 운영자 판단)
  if (select count(*) from table_members where table_id = p_table and attendance in ('SCHEDULED', 'ATTENDED')) < 4 then
    insert into exception_cases(kind, table_id, reason)
    values ('CONFLICT', p_table, '취소로 테이블 인원이 4명 미만이 됨 — 빈자리 충원 필요');
  end if;
  if v_same_day then perform apply_sanction(current_profile_id()); end if;
  return case when v_same_day then 'CANCELED_LATE' else 'CANCELED_EARLY' end;
end $$;

-- ---------------------------------------------------------------------
-- 3) 피드백 제출
-- p = {"table_score":1~5, "convo_score":1~5, "venue_score":1~5, "comment":"...",
--      "people":[{"to":uuid, "kind":"LIKE"|"NEUTRAL"|"AVOID"|"ABSENT"}],
--      "report":{"to":uuid, "reason":"..."}  (선택)}
-- ---------------------------------------------------------------------
create or replace function submit_feedback(p_table uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_profile_id(); st record; x jsonb; v_to uuid; v_coupon uuid;
  cfg jsonb := (select value->'revisit' from settings where key = 'coupons');
begin
  select * into st from my_table_status(p_table);
  if not found then raise exception 'NOT_FOUND'; end if;
  if st.feedback_done then raise exception 'ALREADY_SUBMITTED'; end if;
  if not st.can_feedback then raise exception 'FEEDBACK_CLOSED'; end if;
  if coalesce((p->>'table_score')::int, 0) not between 1 and 5 then raise exception 'SCORE_REQUIRED'; end if;

  perform set_config('app.actor', 'user:' || me, true);
  insert into feedback(table_id, user_id, table_score, convo_score, venue_score, comment)
  values (p_table, me, (p->>'table_score')::int, nullif(p->>'convo_score', '')::int,
          nullif(p->>'venue_score', '')::int, nullif(trim(p->>'comment'), ''));

  -- 피드백을 남겼다 = 참석
  update table_members set attendance = 'ATTENDED' where table_id = p_table and user_id = me and attendance = 'SCHEDULED';

  for x in select * from jsonb_array_elements(coalesce(p->'people', '[]')) loop
    v_to := (x->>'to')::uuid;
    continue when v_to = me or not exists (select 1 from table_members where table_id = p_table and user_id = v_to);
    if x->>'kind' in ('LIKE', 'AVOID') then
      insert into person_preferences(from_user, to_user, kind, table_id)
      values (me, v_to, (x->>'kind')::person_pref_kind, p_table)
      on conflict (from_user, to_user) do update set kind = excluded.kind, table_id = excluded.table_id, created_at = now();
    elsif x->>'kind' = 'ABSENT' then
      insert into attendance_votes(table_id, voter_id, target_id) values (p_table, me, v_to) on conflict do nothing;
    end if;
  end loop;

  -- 신고: 즉시 서로 같은 테이블 배정 금지(차단) + 운영자 예외함
  if p ? 'report' and nullif(trim(p->'report'->>'reason'), '') is not null then
    v_to := (p->'report'->>'to')::uuid;
    if exists (select 1 from table_members where table_id = p_table and user_id = v_to) and v_to <> me then
      insert into safety_reports(reporter_id, reported_id, table_id, reason) values (me, v_to, p_table, p->'report'->>'reason');
      insert into blocks(blocker_id, blocked_id) values (me, v_to) on conflict do nothing;
      insert into exception_cases(kind, table_id, reason)
      values ('SAFETY', p_table, '참가자 신고 접수: ' || left(p->'report'->>'reason', 200));
    end if;
  end if;

  -- 재방문 쿠폰 (테이블당 1장)
  insert into coupons(user_id, kind, discount_rate, expires_at)
  values (me, 'REVISIT', (cfg->>'rate')::numeric, now() + make_interval(days => (cfg->>'valid_days')::int))
  returning id into v_coupon;                       -- 피드백은 테이블당 1번이므로 쿠폰도 1장
  return v_coupon;
end $$;

-- ---------------------------------------------------------------------
-- 4) 참석 확정 (pg_cron 매시간) — 모임 24시간 뒤
-- ---------------------------------------------------------------------
create or replace function finalize_attendance() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_votes int; v_voters int;
begin
  perform set_config('app.actor', 'system:attendance', true);
  for r in
    select m.table_id, m.user_id, m.checked_in_at
      from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
     where m.attendance = 'SCHEDULED' and t.status = 'CONFIRMED' and s.starts_at < now() - interval '24 hours'
  loop
    select count(*) into v_votes from attendance_votes where table_id = r.table_id and target_id = r.user_id;
    select count(distinct user_id) into v_voters from feedback where table_id = r.table_id and user_id <> r.user_id;
    if r.checked_in_at is null and v_votes > 0 and v_votes * 2 >= v_voters then
      update table_members set attendance = 'NO_SHOW' where table_id = r.table_id and user_id = r.user_id;
      perform apply_sanction(r.user_id);
    else
      update table_members set attendance = 'ATTENDED' where table_id = r.table_id and user_id = r.user_id;   -- 증거 없으면 참석으로
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 5) 학습용 데이터 (service_role: /api/learn)
-- ---------------------------------------------------------------------
create or replace view table_outcomes as
select t.id as table_id, t.score_breakdown as phi, t.score as pred,
       avg(f.table_score)::numeric(4,2) as y, count(f.*) as n_feedback, max(f.created_at) as last_feedback_at
  from dining_tables t join feedback f on f.table_id = t.id
 where t.status = 'CONFIRMED' and t.score_breakdown is not null
 group by t.id;
revoke all on table_outcomes from anon, authenticated;

-- 피드백 요약 (운영자 화면·발표용)
create or replace function feedback_summary()
returns table(n_tables bigint, n_feedback bigint, avg_table numeric, avg_convo numeric, avg_venue numeric,
              like_count bigint, avoid_count bigint, reports bigint, no_shows bigint)
language sql stable security definer set search_path = public as $$
  select (select count(distinct table_id) from feedback), (select count(*) from feedback),
         (select round(avg(table_score), 2) from feedback), (select round(avg(convo_score), 2) from feedback),
         (select round(avg(venue_score), 2) from feedback),
         (select count(*) from person_preferences where kind = 'LIKE'),
         (select count(*) from person_preferences where kind = 'AVOID'),
         (select count(*) from safety_reports), (select count(*) from table_members where attendance = 'NO_SHOW')
   where is_admin() or current_user in ('postgres', 'service_role');
$$;

-- 매시간 참석 확정, 매일 04:10 학습
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'finalize-attendance';
    perform cron.schedule('finalize-attendance', '20 * * * *', 'select finalize_attendance()');
  end if;
end $$;

revoke all on function apply_sanction(uuid), finalize_attendance(), demo_mode() from public, anon, authenticated;
revoke all on function my_table_status(uuid), check_in(uuid), cancel_my_seat(uuid), submit_feedback(uuid, jsonb),
                       feedback_summary() from public, anon;
grant execute on function my_table_status(uuid), check_in(uuid), cancel_my_seat(uuid), submit_feedback(uuid, jsonb),
                          feedback_summary() to authenticated;
