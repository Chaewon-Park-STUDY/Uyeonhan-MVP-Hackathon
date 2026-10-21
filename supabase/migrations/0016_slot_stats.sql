-- =====================================================================
-- 0016: 회차 인기도·후기 (참가자 신청 화면) + 실패 사유 판정 보완
--   slot_stats()     : 회차별 신청 수·정원 (개인정보 없는 집계만) → 인기·마감 임박 표시
--   region_reviews() : 지역별 지난 모임 만족도·짧은 후기 (앱에 실제로 남겨진 피드백만, 익명)
--   classify_failure : '남은 사람' 기준으로 다시 판정 (다른 사람들이 먼저 테이블을 채운 경우 구분)
-- 다시 실행해도 안전
-- =====================================================================
create or replace function slot_stats()
returns table(slot_id uuid, picks bigint, capacity int)
language sql stable security definer set search_path = public as $$
  select e.id, count(distinct a.id), e.capacity
    from event_slots e
    left join application_slots x on x.slot_id = e.id
    left join applications a on a.id = x.application_id and a.application_status = 'SUBMITTED'
   where e.is_open and e.apply_deadline > now()
   group by e.id, e.capacity;
$$;
grant execute on function slot_stats() to anon, authenticated;

create or replace function region_reviews()
returns table(region_code text, avg_score numeric, n bigint, comments jsonb)
language sql stable security definer set search_path = public as $$
  select e.region_code, round(avg(f.table_score)::numeric, 1), count(*),
         coalesce((select jsonb_agg(c) from (
            select jsonb_build_object('text', left(f2.comment, 60), 'date', to_char(e2.starts_at at time zone 'Asia/Seoul', 'FMMM/FMDD'),
                                      'score', f2.table_score) as c
              from feedback f2 join dining_tables t2 on t2.id = f2.table_id join event_slots e2 on e2.id = t2.slot_id
             where e2.region_code = e.region_code and length(trim(coalesce(f2.comment, ''))) >= 5 and f2.table_score >= 4
             order by f2.created_at desc limit 2) z), '[]'::jsonb)
    from feedback f join dining_tables t on t.id = f.table_id join event_slots e on e.id = t.slot_id
   where f.table_score is not null
   group by e.region_code;
$$;
grant execute on function region_reviews() to anon, authenticated;

-- 실패 사유: 같은 회차에서 '테이블에 들어가지 못하고 남은 사람' 기준
create or replace function classify_failure(p_app uuid) returns text
language sql stable security definer set search_path = public as $$
  with me as (
    select a.user_id, p.birth_year from applications a join profiles p on p.id = a.user_id where a.id = p_app
  ), myslots as (
    select slot_id from application_slots where application_id = p_app
  ), pool as (       -- 같은 회차를 고른 결제 완료 신청자 전체
    select distinct a2.id, a2.user_id, p2.birth_year
      from application_slots s2 join myslots using (slot_id)
      join applications a2 on a2.id = s2.application_id join profiles p2 on p2.id = a2.user_id
     where a2.id <> p_app and a2.application_status = 'SUBMITTED' and a2.payment_status in ('PAID', 'REFUND_AVAILABLE')
  ), left_over as (  -- 그중 그 회차 테이블에 들어가지 못한 사람
    select pool.* from pool
     where not exists (select 1 from table_members m join dining_tables t on t.id = m.table_id
                        where m.application_id = pool.id and t.status = 'CONFIRMED' and t.slot_id in (select slot_id from myslots))
  ), age_ok as (
    select l.user_id from left_over l, me where abs(l.birth_year - me.birth_year) <= 8
  ), ok as (
    select x.user_id from age_ok x, me
     where not exists (select 1 from excluded_pairs e
                        where e.u1 = least(x.user_id, me.user_id) and e.u2 = greatest(x.user_id, me.user_id))
  )
  select case
    when (select count(*) from pool) < 3 then '인원 부족: 같은 날짜·지역 신청자가 4명이 안 됐어요'
    when (select count(*) from left_over) < 3 then '인원 부족: 다른 신청자들로 테이블이 먼저 채워져 남은 인원이 4명이 안 됐어요'
    when (select count(*) from age_ok) < 3 then '나이 조건: 남은 신청자 중 나이 차이 8살 이내인 사람이 부족했어요'
    when (select count(*) from ok) < 3 then '제외 관계: 차단·신고·"다시는" 관계를 빼면 함께할 사람이 부족했어요'
    else '만족도 기준 미달: 남은 사람끼리 만든 조합의 예상 만족도가 최소 점수보다 낮았어요'
  end;
$$;

-- 0015 에서 자동 판정한 사유만 다시 판정 (엔진·운영자가 쓴 사유는 그대로)
update match_resolutions set reason = null
 where reason in ('인원 부족: 같은 날짜·지역 신청자가 4명이 안 됐어요',
                  '나이 조건: 나이 차이 8살 이내인 신청자가 부족했어요',
                  '제외 관계: 차단·신고·"다시는" 관계를 빼면 함께할 사람이 부족했어요',
                  '만족도 기준 미달: 남은 사람끼리 만든 조합의 예상 만족도가 최소 점수보다 낮았어요');
