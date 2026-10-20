-- =====================================================================
-- 0010: 운영자 어드민 (A6 · PRD 11장 ADM-01~10)
--   운영자(profiles.role = 'admin')는 대부분의 테이블을 이미 RLS로 읽을 수 있다.
--   여기서는 운영 화면에서 바꾸는 것(회차 열기/닫기, 식당 켜기/끄기)에 쓰기 권한을 준다.
--   설정(settings)·예외(exception_cases)는 0001에서 이미 운영자 전체 권한.
-- 다시 실행해도 안전
-- =====================================================================
drop policy if exists admin_slots_write on event_slots;
create policy admin_slots_write on event_slots for update using (is_admin()) with check (is_admin());
drop policy if exists admin_venues_write on venues;
create policy admin_venues_write on venues for update using (is_admin()) with check (is_admin());

-- 날짜별 운영 현황 (대시보드 표)
create or replace function admin_overview()
returns table(run_date date, slots int, open_slots int, apps_total bigint, apps_paid bigint, apps_pending bigint,
              confirmed_tables bigint, confirmed_people bigint, offered bigint, matched_at timestamptz,
              match_run_at timestamptz, deadline timestamptz)
language sql stable security definer set search_path = public as $$
  with d as (
    select (starts_at at time zone 'Asia/Seoul')::date as run_date, count(*)::int as slots,
           count(*) filter (where is_open)::int as open_slots, min(match_run_at) as match_run_at, min(apply_deadline) as deadline
      from event_slots group by 1
  ), a as (
    select distinct on (a.id) a.*, (e.starts_at at time zone 'Asia/Seoul')::date as run_date
      from applications a join application_slots s on s.application_id = a.id join event_slots e on e.id = s.slot_id
     where a.application_status = 'SUBMITTED'
     order by a.id, e.starts_at
  )
  select d.run_date, d.slots, d.open_slots,
         (select count(*) from a where a.run_date = d.run_date),
         (select count(*) from a where a.run_date = d.run_date and a.payment_status = 'PAID'),
         (select count(*) from a where a.run_date = d.run_date and a.payment_status = 'PENDING'),
         (select count(*) from dining_tables t join event_slots e on e.id = t.slot_id
           where t.status = 'CONFIRMED' and (e.starts_at at time zone 'Asia/Seoul')::date = d.run_date),
         (select count(*) from table_members m join dining_tables t on t.id = m.table_id join event_slots e on e.id = t.slot_id
           where t.status = 'CONFIRMED' and (e.starts_at at time zone 'Asia/Seoul')::date = d.run_date),
         (select count(*) from a where a.run_date = d.run_date and a.match_status = 'ALTERNATIVE_OFFERED'),
         (select finished_at from match_runs r where r.run_key = d.run_date::text),
         d.match_run_at, d.deadline
    from d
   where is_admin()
   order by d.run_date;
$$;

-- 서울 외 지역 확장 수요 (대기 명단 지역별 집계)
create or replace function admin_region_demand()
returns table(area text, people bigint, accept_seoul bigint)
language sql stable security definer set search_path = public as $$
  select trim(area_text), count(*), count(*) filter (where accept_seoul)
    from region_waitlist where is_admin()
   group by trim(area_text) order by 2 desc;
$$;

revoke all on function admin_overview(), admin_region_demand() from public, anon;
grant execute on function admin_overview(), admin_region_demand() to authenticated;

-- ---------------------------------------------------------------------
-- 노쇼 보상 (설정 화면 토글: no_show_sanction.compensation.enabled)
--   노쇼가 생긴 테이블의 참석자에게 보상 쿠폰. 노쇼자가 잃은 금액의 pool_rate(50%)를 참석자 수로 나눈 할인율
--   예) 5명 중 1명 노쇼 → 참석 4명에게 각 12.5% (최소 5%)
-- ---------------------------------------------------------------------
create or replace function finalize_attendance() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0; v_votes int; v_voters int; v_tables uuid[] := '{}'; t uuid; v_att int; v_ns int;
  comp jsonb := (select value->'compensation' from settings where key = 'no_show_sanction');
begin
  perform set_config('app.actor', 'system:attendance', true);
  for r in
    select m.table_id, m.user_id, m.checked_in_at
      from table_members m join dining_tables dt on dt.id = m.table_id join event_slots s on s.id = dt.slot_id
     where m.attendance = 'SCHEDULED' and dt.status = 'CONFIRMED' and s.starts_at < now() - interval '24 hours'
  loop
    select count(*) into v_votes from attendance_votes where table_id = r.table_id and target_id = r.user_id;
    select count(distinct user_id) into v_voters from feedback where table_id = r.table_id and user_id <> r.user_id;
    if r.checked_in_at is null and v_votes > 0 and v_votes * 2 >= v_voters then
      update table_members set attendance = 'NO_SHOW' where table_id = r.table_id and user_id = r.user_id;
      perform apply_sanction(r.user_id);
      v_tables := array_append(v_tables, r.table_id);
    else
      update table_members set attendance = 'ATTENDED' where table_id = r.table_id and user_id = r.user_id;
    end if;
    n := n + 1;
  end loop;

  if coalesce((comp->>'enabled')::boolean, false) then
    foreach t in array (select array_agg(distinct x) from unnest(v_tables) x) loop
      select count(*) filter (where attendance = 'ATTENDED'), count(*) filter (where attendance = 'NO_SHOW')
        into v_att, v_ns from table_members where table_id = t;
      continue when v_att = 0;
      insert into coupons(user_id, kind, discount_rate, expires_at)
      select m.user_id, 'NO_SHOW_COMPENSATION',
             greatest(0.05, least(0.5, round(coalesce((comp->>'pool_rate')::numeric, 0.5) * v_ns / v_att, 3))),
             now() + make_interval(days => coalesce((comp->>'coupon_valid_days')::int, 30))
        from table_members m where m.table_id = t and m.attendance = 'ATTENDED';
      insert into chat_messages(room_id, kind, content)
      select c.id, 'NOTICE', '함께하기로 한 분이 오지 않아 미안해요. 참석해 주신 분들께 다음 신청에 쓸 수 있는 보상 쿠폰을 드렸어요.'
        from chat_rooms c where c.table_id = t;
    end loop;
  end if;
  return n;
end $$;
revoke all on function finalize_attendance() from public, anon, authenticated;
