-- =====================================================================
-- 0022: 같은 날 두 모임 방지
--   진행 중인 신청(취소·환불·매칭 종료 제외)과 같은 날짜의 회차는 새로 신청하거나
--   '다른 회차로 이동'으로 고를 수 없음 (한 사람이 같은 저녁 두 테이블에 배정되는 것 방지)
-- 다시 실행해도 안전
-- =====================================================================
create or replace function guard_one_per_day() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_day date;
begin
  select user_id into v_user from applications where id = new.application_id;
  select (starts_at at time zone 'Asia/Seoul')::date into v_day from event_slots where id = new.slot_id;
  if exists (
    select 1 from applications a
      join application_slots s on s.application_id = a.id
      join event_slots e on e.id = s.slot_id
     where a.user_id = v_user and a.id <> new.application_id
       and a.application_status = 'SUBMITTED'
       and a.match_status <> 'NO_MATCH'
       and a.payment_status::text not like 'REFUND%'
       and (e.starts_at at time zone 'Asia/Seoul')::date = v_day) then
    raise exception 'SAME_DAY_APPLIED';
  end if;
  return new;
end $$;
drop trigger if exists trg_one_per_day on application_slots;
create trigger trg_one_per_day before insert on application_slots
for each row execute function guard_one_per_day();

-- 매칭 실패 시 미리 고른 '다른 날짜·지역으로 이동' 자동 적용: 이미 다른 신청이 있는 날짜는 건너뛰고 다음 후보로
create or replace function auto_apply_prechoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a applications%rowtype; v_dates date[]; v_slot uuid;
begin
  select * into a from applications where id = new.application_id;
  if a.match_status <> 'ALTERNATIVE_OFFERED' then return new; end if;

  select array_agg(distinct (e.starts_at at time zone 'Asia/Seoul')::date) into v_dates
    from application_slots s join event_slots e on e.id = s.slot_id where s.application_id = a.id;

  if a.fail_pref in ('MOVE_DATE', 'MOVE_REGION') then
    select e.id into v_slot
      from unnest(new.offered_slots) o(id) join event_slots e on e.id = o.id
     where e.is_open and e.apply_deadline > now()
       and case when a.fail_pref = 'MOVE_DATE'
                then not ((e.starts_at at time zone 'Asia/Seoul')::date = any(v_dates))
                else (e.starts_at at time zone 'Asia/Seoul')::date = any(v_dates) end
       and not exists (
         select 1 from applications b
           join application_slots bs on bs.application_id = b.id
           join event_slots be on be.id = bs.slot_id
          where b.user_id = a.user_id and b.id <> a.id and b.application_status = 'SUBMITTED'
            and b.match_status <> 'NO_MATCH' and b.payment_status::text not like 'REFUND%'
            and (be.starts_at at time zone 'Asia/Seoul')::date = (e.starts_at at time zone 'Asia/Seoul')::date)
     order by e.starts_at limit 1;
    if v_slot is null then return new; end if;
    perform resolve_internal(a.id, a.fail_pref, v_slot);
  else
    perform resolve_internal(a.id, a.fail_pref, null);
  end if;
  return new;
exception when others then
  return new;   -- 자동 처리 실패 시 참가자 직접 선택으로 남겨 둔다
end $$;
revoke all on function auto_apply_prechoice() from public, anon, authenticated;
