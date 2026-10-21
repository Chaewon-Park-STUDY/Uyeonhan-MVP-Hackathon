-- =====================================================================
-- 0021: 지난 모임 후기 — 지역을 누르면 최근 한마디를 최대 5개까지 보여 줌
-- 다시 실행해도 안전
-- =====================================================================
create or replace function region_reviews()
returns table(region_code text, avg_score numeric, n bigint, comments jsonb)
language sql stable security definer set search_path = public as $$
  select e.region_code, round(avg(f.table_score)::numeric, 1), count(*),
         coalesce((select jsonb_agg(c) from (
            select jsonb_build_object('text', left(f2.comment, 60), 'date', to_char(e2.starts_at at time zone 'Asia/Seoul', 'FMMM/FMDD'),
                                      'score', f2.table_score) as c
              from feedback f2 join dining_tables t2 on t2.id = f2.table_id join event_slots e2 on e2.id = t2.slot_id
             where e2.region_code = e.region_code and length(trim(coalesce(f2.comment, ''))) >= 5 and f2.table_score >= 4
             order by f2.created_at desc limit 5) z), '[]'::jsonb)
    from feedback f join dining_tables t on t.id = f.table_id join event_slots e on e.id = t.slot_id
   where f.table_score is not null
   group by e.region_code;
$$;
grant execute on function region_reviews() to anon, authenticated;
