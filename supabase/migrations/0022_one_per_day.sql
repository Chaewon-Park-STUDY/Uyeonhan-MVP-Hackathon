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
