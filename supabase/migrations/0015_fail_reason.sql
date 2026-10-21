-- =====================================================================
-- 0015: 매칭 실패 사유 분류 (운영자 화면·참가자 안내용)
--   엔진이 구체 사유를 주지 않았거나 예전 실행분이면, 신청 데이터로 사유를 판정해 채움
--   분류: 인원 부족 / 나이 조건 / 제외 관계 / 만족도 기준 미달  ("분류: 설명" 형식)
-- 다시 실행해도 안전
-- =====================================================================
create or replace function classify_failure(p_app uuid) returns text
language sql stable security definer set search_path = public as $$
  with me as (
    select a.user_id, p.birth_year from applications a join profiles p on p.id = a.user_id where a.id = p_app
  ), pool as (       -- 같은 회차(날짜·지역)를 고른 결제 완료 신청자
    select distinct a2.user_id, p2.birth_year
      from application_slots s join application_slots s2 on s2.slot_id = s.slot_id
      join applications a2 on a2.id = s2.application_id join profiles p2 on p2.id = a2.user_id
     where s.application_id = p_app and a2.id <> p_app and a2.application_status = 'SUBMITTED'
       and a2.payment_status in ('PAID', 'REFUND_AVAILABLE')
  ), age_ok as (
    select pool.user_id from pool, me where abs(pool.birth_year - me.birth_year) <= 8
  ), ok as (
    select x.user_id from age_ok x, me
     where not exists (select 1 from excluded_pairs e
                        where e.u1 = least(x.user_id, me.user_id) and e.u2 = greatest(x.user_id, me.user_id))
  )
  select case
    when (select count(*) from pool) < 3 then '인원 부족: 같은 날짜·지역 신청자가 4명이 안 됐어요'
    when (select count(*) from age_ok) < 3 then '나이 조건: 나이 차이 8살 이내인 신청자가 부족했어요'
    when (select count(*) from ok) < 3 then '제외 관계: 차단·신고·"다시는" 관계를 빼면 함께할 사람이 부족했어요'
    else '만족도 기준 미달: 남은 사람끼리 만든 조합의 예상 만족도가 최소 점수보다 낮았어요'
  end;
$$;

-- 엔진이 준 사유를 같은 분류 형식으로 맞추기
create or replace function normalize_fail_reason() returns trigger
language plpgsql as $$
begin
  if new.reason is null or new.reason = '' or new.reason like '조건을 만족하는%' then
    new.reason := classify_failure(new.application_id);
  elsif new.reason not like '%:%' then
    new.reason := case
      when new.reason like '%점수%' then '만족도 기준 미달: ' || new.reason
      when new.reason like '%나이%' then '나이 조건: ' || new.reason
      when new.reason like '%차단%' or new.reason like '%제외%' then '제외 관계: ' || new.reason
      when new.reason like '%인원%' or new.reason like '%명%' then '인원 부족: ' || new.reason
      else '기타: ' || new.reason end;
  end if;
  return new;
end $$;

drop trigger if exists trg_normalize_fail_reason on match_resolutions;
create trigger trg_normalize_fail_reason before insert or update of reason on match_resolutions
for each row execute function normalize_fail_reason();

-- 예전 실행분 채우기
update match_resolutions set reason = null where reason is null or reason = '' or reason like '조건을 만족하는%';   -- 트리거로 판정
