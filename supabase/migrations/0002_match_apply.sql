-- =====================================================================
-- 0002: 매칭 결과 저장 (DESIGN.md 4.7, PRD 7.1 · 7.3)
--   - model_snapshots : 베이지안 사후분포 저장 (v2/v3)
--   - apply_match_run : 매칭 엔진 결과를 한 트랜잭션으로 반영 (멱등)
-- =====================================================================

create table if not exists model_snapshots (
  id          bigint generated always as identity primary key,
  version     text not null,                   -- 'v2-nig'
  params      jsonb not null,                  -- {mu, Lam, a, b}
  n_obs       int not null default 0,          -- 학습에 쓴 테이블 수
  created_at  timestamptz not null default now()
);
alter table model_snapshots enable row level security;
create policy admin_models on model_snapshots for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- payload 형식
-- {
--   "run_key": "2026-10-22", "algorithm_version": "v2-mean", "params": {...}, "stats": {...},
--   "tables":   [{"slot_id", "members": [application_id...], "phi": {...}, "pred": 4.3,
--                 "explanation": {...}, "reasons": {application_id: {"reallocations": n, "reason": "..."}}}],
--   "carry_over": [application_id...],                        -- 다음 희망 날짜로 이월 (WAITING 유지)
--   "failed":   [{"application_id", "reason", "alternatives": [slot_id...]}]
-- }
-- ---------------------------------------------------------------------
create or replace function apply_match_run(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run_id   uuid;
  t          jsonb;
  f          jsonb;
  v_table_id uuid;
  n_conf     int := 0;
  n_exc      int := 0;
  n_failed   int := 0;
begin
  perform set_config('app.actor', 'system:matcher', true);

  -- 멱등성: 같은 run_key는 한 번만 반영
  insert into match_runs(run_key, algorithm_version, params, stats)
  values (payload->>'run_key', payload->>'algorithm_version',
          coalesce(payload->'params', '{}'::jsonb), payload->'stats')
  on conflict (run_key) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    return jsonb_build_object('status', 'ALREADY_RUN', 'run_key', payload->>'run_key');
  end if;

  -- 테이블 생성 → 멤버 → 확정 (확정 트리거가 필수 조건 재검증)
  for t in select * from jsonb_array_elements(coalesce(payload->'tables', '[]'::jsonb)) loop
    begin
      insert into dining_tables(slot_id, match_run_id, score, score_breakdown, explanation)
      values ((t->>'slot_id')::uuid, v_run_id, (t->>'pred')::numeric, t->'phi', t->'explanation')
      returning id into v_table_id;

      insert into table_members(table_id, application_id, user_id, reallocation_count, placement_reason)
      select v_table_id, a.id, a.user_id,
             coalesce((t->'reasons'->(a.id::text)->>'reallocations')::int, 0),
             t->'reasons'->(a.id::text)->>'reason'
        from applications a
       where a.id in (select (jsonb_array_elements_text(t->'members'))::uuid);

      update dining_tables set status = 'CONFIRMED' where id = v_table_id;

      update applications
         set match_status = 'CONFIRMED', assigned_slot_id = (t->>'slot_id')::uuid
       where id in (select (jsonb_array_elements_text(t->'members'))::uuid);

      n_conf := n_conf + 1;
    exception when others then
      -- 자동 확정 실패 → 이 테이블만 되돌리고 운영자 예외로 (PRD MAT-13)
      insert into exception_cases(kind, reason)
      values ('CONFLICT', '자동 확정 실패: ' || sqlerrm || ' / slot ' || (t->>'slot_id'));
      update applications set match_status = 'EXCEPTION'
       where id in (select (jsonb_array_elements_text(t->'members'))::uuid);
      n_exc := n_exc + 1;
    end;
  end loop;

  -- 매칭 실패 → 대체 회차 제시 (PRD MAT-11, STA-04)
  for f in select * from jsonb_array_elements(coalesce(payload->'failed', '[]'::jsonb)) loop
    update applications set match_status = 'ALTERNATIVE_OFFERED'
     where id = (f->>'application_id')::uuid and match_status = 'WAITING';
    insert into match_resolutions(application_id, offered_slots)
    values ((f->>'application_id')::uuid,
            coalesce(array(select (jsonb_array_elements_text(f->'alternatives'))::uuid), '{}'))
    on conflict (application_id) do update set offered_slots = excluded.offered_slots;
    n_failed := n_failed + 1;
  end loop;

  update match_runs
     set finished_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
           'tables_confirmed', n_conf, 'tables_exception', n_exc, 'failed', n_failed,
           'carried_over', jsonb_array_length(coalesce(payload->'carry_over', '[]'::jsonb)))
   where id = v_run_id;

  return jsonb_build_object('status', 'OK', 'run_id', v_run_id, 'tables_confirmed', n_conf,
                            'tables_exception', n_exc, 'failed', n_failed);
end $$;

-- 매칭 엔진(service_role)만 호출 가능
revoke all on function apply_match_run(jsonb) from public, anon, authenticated;
grant execute on function apply_match_run(jsonb) to service_role;
