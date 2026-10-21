-- =====================================================================
-- 0024: '식당 자동 배정 실패' 처리 건에 테이블 연결
--   예전 기록은 사유 문장 안에만 테이블 번호가 있어, 처리대기함에서 '식당 직접 지정'이 안 보였음
-- 다시 실행해도 안전
-- =====================================================================
update exception_cases
   set table_id = substring(reason from 'table ([0-9a-f-]{36})')::uuid
 where kind = 'VENUE' and table_id is null and reason ~ 'table [0-9a-f-]{36}';

create or replace function fill_case_table() returns trigger
language plpgsql as $$
begin
  if new.table_id is null and new.reason ~ 'table [0-9a-f-]{36}' then
    new.table_id := substring(new.reason from 'table ([0-9a-f-]{36})')::uuid;
  end if;
  return new;
end $$;
drop trigger if exists trg_fill_case_table on exception_cases;
create trigger trg_fill_case_table before insert on exception_cases
for each row execute function fill_case_table();
