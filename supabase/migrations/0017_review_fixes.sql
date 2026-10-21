-- =====================================================================
-- 0017: 독립 검토 2차 반영
--   결제 전 취소한 신청은 결제 불가 (mock_pay)
--   자동 확정 실패자 → '다른 일정 선택'으로 (갇히지 않게) + 쉬운 말 사유
--   처리대기함 사유의 영어 코드·id 정리, 식당 배정 실패 건에 테이블 연결
--   신고 상세에 성별·나이, 테이블 소개 인원에서 취소자 제외
-- 다시 실행해도 안전
-- =====================================================================

create or replace function mock_pay(p_app uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a applications%rowtype;
begin
  select * into a from applications where id = p_app and user_id = current_profile_id();
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.application_status <> 'SUBMITTED' then raise exception 'CANCELED_APPLICATION'; end if;
  if a.payment_status = 'PAID' then return 'ALREADY_PAID'; end if;
  if a.payment_status <> 'PENDING' then raise exception 'INVALID_STATE %', a.payment_status; end if;

  perform set_config('app.actor', 'user:' || a.user_id, true);
  update payments set status = 'PAID' where application_id = p_app and status = 'PENDING';
  update applications set payment_status = 'PAID' where id = p_app;
  update coupons set used_at = now() where id = a.coupon_id and used_at is null;
  return 'PAID';
end $$;

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
  v_all      uuid[];
  v_why      text;
  m_app      uuid;
begin
  perform set_config('app.actor', 'system:matcher', true);

  insert into match_runs(run_key, algorithm_version, params, stats)
  values (payload->>'run_key', payload->>'algorithm_version',
          coalesce(payload->'params', '{}'::jsonb), payload->'stats')
  on conflict (run_key) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    return jsonb_build_object('status', 'ALREADY_RUN', 'run_key', payload->>'run_key');
  end if;

  -- 이번 실행 대상 전원: 매칭 중
  v_all := array(
    select (jsonb_array_elements_text(x->'members'))::uuid from jsonb_array_elements(coalesce(payload->'tables', '[]')) x
    union select (x->>'application_id')::uuid from jsonb_array_elements(coalesce(payload->'failed', '[]')) x
    union select (jsonb_array_elements_text(coalesce(payload->'carry_over', '[]')))::uuid);
  update applications set match_status = 'MATCHING'
   where id = any(v_all) and match_status in ('WAITING', 'TRANSFERRED', 'REALLOCATING');

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
      -- 확정 직전 재검증 실패: 참가자는 '다른 일정 선택'으로 보내고(갇히지 않게), 운영자에게는 쉬운 말로 기록
      v_why := case
        when sqlerrm like 'TABLE_SIZE_INVALID%' then '인원 부족: 확정 직전 확인에서 인원이 4~6명이 아니었어요'
        when sqlerrm like 'AGE_GAP_EXCEEDED%' then '나이 조건: 확정 직전 확인에서 나이 차이가 8살을 넘었어요'
        when sqlerrm like 'EXCLUDED_PAIR_PRESENT%' then '제외 관계: 확정 직전 확인에서 차단·신고 관계가 발견됐어요'
        when sqlerrm like 'UNPAID_MEMBER%' then '기타: 확정 직전 확인에서 결제가 끝나지 않은 사람이 있었어요'
        when sqlerrm like 'SLOT_NOT_CHOSEN%' then '기타: 확정 직전 확인에서 고르지 않은 회차가 섞였어요'
        else '기타: 확정 직전 확인에서 조건이 맞지 않았어요' end;
      for m_app in select (jsonb_array_elements_text(t->'members'))::uuid loop
        insert into exception_cases(kind, application_id, reason)
        values ('CONFLICT', m_app, '자동 확정 보류 → 참가자에게 다른 일정을 제안했어요. ' || v_why);
        update applications set match_status = 'ALTERNATIVE_OFFERED' where id = m_app;
        insert into match_resolutions(application_id, offered_slots, reason)
        values (m_app, coalesce(array(select e.id from event_slots e
                                       where e.is_open and e.apply_deadline > now() and e.id <> (t->>'slot_id')::uuid
                                       order by e.starts_at limit 3), '{}'), v_why)
        on conflict (application_id) do update set offered_slots = excluded.offered_slots, reason = excluded.reason,
                                                   choice = null, chosen_slot_id = null, resolved_at = null;
      end loop;
      n_exc := n_exc + 1;
    end;
  end loop;

  -- 다음 희망 날짜로 넘김 = 다른 테이블 찾는 중 (PRD 7.4 ③④)
  update applications set match_status = 'REALLOCATING'
   where id in (select (jsonb_array_elements_text(coalesce(payload->'carry_over', '[]')))::uuid)
     and match_status = 'MATCHING';

  -- 매칭 실패 → 사유 + 대체 회차 (MAT-11, STA-04)
  for f in select * from jsonb_array_elements(coalesce(payload->'failed', '[]'::jsonb)) loop
    -- 상태를 먼저 바꿔야 미리 고른 선택지 자동 적용(auto_apply_prechoice)이 동작
    update applications set match_status = 'ALTERNATIVE_OFFERED'
     where id = (f->>'application_id')::uuid and match_status in ('MATCHING', 'WAITING', 'TRANSFERRED', 'REALLOCATING');
    insert into match_resolutions(application_id, offered_slots, reason)
    values ((f->>'application_id')::uuid,
            coalesce(array(select (jsonb_array_elements_text(f->'alternatives'))::uuid), '{}'), f->>'reason')
    on conflict (application_id) do update set offered_slots = excluded.offered_slots, reason = excluded.reason,
                                               choice = null, chosen_slot_id = null, resolved_at = null;
    n_failed := n_failed + 1;
  end loop;

  -- 남은 '매칭 중'은 원래대로
  update applications set match_status = 'WAITING' where id = any(v_all) and match_status = 'MATCHING';

  update match_runs
     set finished_at = now(),
         stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
           'tables_confirmed', n_conf, 'tables_exception', n_exc, 'failed', n_failed,
           'carried_over', jsonb_array_length(coalesce(payload->'carry_over', '[]'::jsonb)))
   where id = v_run_id;

  return jsonb_build_object('status', 'OK', 'run_id', v_run_id, 'tables_confirmed', n_conf,
                            'tables_exception', n_exc, 'failed', n_failed);
end $$;
revoke all on function apply_match_run(jsonb) from public, anon, authenticated;
grant execute on function apply_match_run(jsonb) to service_role;

-- 처리대기함 사유 정리: "... / table <id>" 꼬리를 떼고 table_id 로 연결
create or replace function tidy_exception() returns trigger
language plpgsql as $$
declare m text[];
begin
  m := regexp_match(new.reason, ' / table ([0-9a-f-]{36})$');
  if m is not null then
    new.table_id := coalesce(new.table_id, m[1]::uuid);
    new.reason := regexp_replace(new.reason, ' / table [0-9a-f-]{36}$', '');
  end if;
  new.reason := regexp_replace(new.reason, ' / slot [0-9a-f-]{36}$', '');
  return new;
end $$;
drop trigger if exists trg_tidy_exception on exception_cases;
create trigger trg_tidy_exception before insert on exception_cases
for each row execute function tidy_exception();

update exception_cases
   set table_id = coalesce(table_id, (regexp_match(reason, ' / table ([0-9a-f-]{36})$'))[1]::uuid),
       reason = regexp_replace(regexp_replace(reason, ' / (table|slot) [0-9a-f-]{36}$', ''),
                               '자동 확정 실패: (TABLE_SIZE_INVALID|AGE_GAP_EXCEEDED|EXCLUDED_PAIR_PRESENT)[^/]*', '자동 확정 보류: 확정 직전 조건 확인에서 맞지 않았어요')
 where reason ~ ' / (table|slot) [0-9a-f-]{36}$' or reason like '자동 확정 실패:%';

-- 신고 상세: 성별·나이
drop function if exists admin_safety_detail(uuid);
create function admin_safety_detail(p_exception uuid)
returns table(reporter text, reported text, reason text, reported_restricted_until timestamptz,
              reporter_gender text, reporter_birth int, reported_gender text, reported_birth int)
language sql stable security definer set search_path = public as $$
  select pr.name, pd.name, r.reason, pd.restricted_until, pr.gender::text, pr.birth_year, pd.gender::text, pd.birth_year
    from exception_cases e
    join safety_reports r on r.id = e.report_id
    join profiles pr on pr.id = r.reporter_id
    join profiles pd on pd.id = r.reported_id
   where e.id = p_exception and e.kind = 'SAFETY' and is_admin();
$$;
revoke all on function admin_safety_detail(uuid) from public, anon;
grant execute on function admin_safety_detail(uuid) to authenticated;

-- 테이블 소개: 취소한 사람은 빼고 보여 줌 ("나 포함 N명"이 실제 인원과 맞게)
create or replace function table_intro(p_table_id uuid)
returns table(nickname text, age_band text, mbti text, interests text[], is_me boolean, animals text[])
language sql stable security definer set search_path = public as $$
  select left(p.name, 1) || '○○',
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests, p.id = current_profile_id(), p.self_traits
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id and m.attendance not in ('CANCELED_EARLY', 'CANCELED_LATE')
     and exists (select 1 from dining_tables t where t.id = p_table_id and t.status = 'CONFIRMED')
     and (is_table_member(p_table_id) or is_admin())
   order by (p.id = current_profile_id()) desc;
$$;
