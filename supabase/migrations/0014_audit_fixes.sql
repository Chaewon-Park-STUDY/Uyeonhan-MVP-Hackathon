-- =====================================================================
-- 0014: 독립 검토(PRD 전수 대조)에서 나온 보완
--   §16  참가자가 자기 권한(role)·제한(restricted_until)을 바꾸지 못하게 (보안)
--   FDB-01 체크인 없는 사람은 자동 '참석'이 아니라 노쇼 후보로 남김
--   STA-01 매칭 전 신청 취소 (결제했으면 전액 환불)
--   STA-04/MAT-12 매칭 실패 사유 저장·표시
--   PAY-01/§12 환불 가능·환불 요청·이동 완료·재배치 중·매칭 중 상태를 실제로 기록
--   MAT-07 확정 직전 재검증에 결제 완료·희망 날짜/지역 포함
--   SAF-02 신고 조치가 정확히 그 신고에 적용되게
--   §16  운영 추적: 주요 변경을 audit_log 에 기록
-- 다시 실행해도 안전
-- =====================================================================

-- ---------------------------------------------------------------------
-- §16 보안: 참가자는 본인 프로필의 권한·제재·탈퇴 관련 칸을 바꿀 수 없음
--   (RPC 안에서 바뀌는 건 함수 소유자 권한이라 통과, API 직접 호출만 막음)
-- ---------------------------------------------------------------------
create or replace function guard_profile_columns() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin() then
    if tg_op = 'INSERT' then
      if new.role <> 'participant' or new.restricted_until is not null then raise exception 'FORBIDDEN_FIELD'; end if;
    elsif new.role is distinct from old.role
       or new.restricted_until is distinct from old.restricted_until
       or new.deleted_at is distinct from old.deleted_at
       or new.auth_user_id is distinct from old.auth_user_id
       or new.referral_code is distinct from old.referral_code then
      raise exception 'FORBIDDEN_FIELD';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile on profiles;
create trigger trg_guard_profile before insert or update on profiles
for each row execute function guard_profile_columns();

-- 참가자는 신고 상태·피드백 이후 수정 불가 (작성만)
drop policy if exists own_reports on safety_reports;
drop policy if exists own_reports_r on safety_reports;
drop policy if exists own_reports_w on safety_reports;
create policy own_reports_r on safety_reports for select using (reporter_id = current_profile_id() or is_admin());
create policy own_reports_w on safety_reports for insert with check (reporter_id = current_profile_id());

-- ---------------------------------------------------------------------
-- FDB-01: 참석 자동 판정
--   체크인 했거나 본인이 피드백을 냈으면 → 참석
--   다른 참가자 과반이 "안 왔어요" → 노쇼 (벌점)
--   그 외(증거 없음) → 그대로 두어 '노쇼 후보' → 운영자가 참석 화면에서 확인
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
    if r.checked_in_at is not null
       or exists (select 1 from feedback f where f.table_id = r.table_id and f.user_id = r.user_id) then
      update table_members set attendance = 'ATTENDED' where table_id = r.table_id and user_id = r.user_id;
      n := n + 1;
    elsif v_votes > 0 and v_votes * 2 >= v_voters then
      update table_members set attendance = 'NO_SHOW' where table_id = r.table_id and user_id = r.user_id;
      perform apply_sanction(r.user_id);
      v_tables := array_append(v_tables, r.table_id);
      n := n + 1;
    end if;
    -- 증거가 없으면 SCHEDULED 유지 = 노쇼 후보
  end loop;

  if coalesce((comp->>'enabled')::boolean, false) then
    foreach t in array (select coalesce(array_agg(distinct x), '{}') from unnest(v_tables) x) loop
      select count(*) filter (where attendance = 'ATTENDED'), count(*) filter (where attendance = 'NO_SHOW')
        into v_att, v_ns from table_members where table_id = t;
      continue when v_att = 0;
      insert into coupons(user_id, kind, discount_rate, expires_at, source_ref)
      select m.user_id, 'NO_SHOW_COMPENSATION',
             greatest(0.05, least(0.5, round(coalesce((comp->>'pool_rate')::numeric, 0.5) * v_ns / v_att, 3))),
             now() + make_interval(days => coalesce((comp->>'coupon_valid_days')::int, 30)), t
        from table_members m where m.table_id = t and m.attendance = 'ATTENDED'
      on conflict do nothing;
      insert into chat_messages(room_id, kind, content)
      select c.id, 'NOTICE', '함께하기로 한 분이 오지 않아 미안해요. 참석해 주신 분들께 다음 신청에 쓸 수 있는 보상 쿠폰을 드렸어요.'
        from chat_rooms c where c.table_id = t;
    end loop;
  end if;
  return n;
end $$;
revoke all on function finalize_attendance() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- PAY-01 / §12: 결제 상태 자동 전환
--   매칭 실패(ALTERNATIVE_OFFERED) + 1회권 결제 완료 → REFUND_AVAILABLE (환불 선택 가능)
--   다른 일정으로 이동·이용권 보관을 고르면 → 다시 PAID
-- ---------------------------------------------------------------------
create or replace function app_payment_state() returns trigger
language plpgsql as $$
begin
  if new.match_status = 'ALTERNATIVE_OFFERED' and old.match_status is distinct from 'ALTERNATIVE_OFFERED'
     and new.payment_status = 'PAID'
     and exists (select 1 from passes p where p.id = new.pass_id and p.type = 'SINGLE')
     and exists (select 1 from payments y where y.application_id = new.id and y.status = 'PAID' and y.amount > 0) then
    new.payment_status := 'REFUND_AVAILABLE';
  end if;
  if old.match_status = 'ALTERNATIVE_OFFERED' and new.match_status is distinct from 'ALTERNATIVE_OFFERED'
     and new.payment_status = 'REFUND_AVAILABLE' then
    new.payment_status := 'PAID';
  end if;
  return new;
end $$;

drop trigger if exists trg_app_payment_state on applications;
create trigger trg_app_payment_state before update on applications
for each row execute function app_payment_state();

-- STA-04: 매칭 실패 사유
alter table match_resolutions add column if not exists reason text;

-- ---------------------------------------------------------------------
-- 매칭 실패 해결 (STA-05, STA-06, PAY-03) — 0004 재정의
--   이동: TRANSFERRED (새 회차 매칭 대상), 환불: REFUND_REQUESTED → PROCESSING → REFUNDED
-- ---------------------------------------------------------------------
create or replace function resolve_internal(p_app uuid, p_choice fail_preference, p_slot uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  a applications%rowtype; r match_resolutions%rowtype; ps passes%rowtype;
  v_ext int := coalesce((select (value->>'membership_fail_extension_days')::int from settings where key = 'pricing'), 7);
begin
  select * into a from applications where id = p_app;
  if a.match_status <> 'ALTERNATIVE_OFFERED' then raise exception 'INVALID_STATE %', a.match_status; end if;
  select * into r from match_resolutions where application_id = p_app;
  select * into ps from passes where id = a.pass_id;

  if p_choice in ('MOVE_DATE', 'MOVE_REGION') then
    if p_slot is null or not (p_slot = any(r.offered_slots)) then raise exception 'SLOT_NOT_OFFERED'; end if;
    if not exists (select 1 from event_slots where id = p_slot and is_open and apply_deadline > now()) then
      raise exception 'SLOT_CLOSED';
    end if;
    delete from application_slots where application_id = p_app;
    insert into application_slots(application_id, slot_id) values (p_app, p_slot);
    update applications set match_status = 'TRANSFERRED', assigned_slot_id = null where id = p_app;
    update match_resolutions set choice = p_choice, chosen_slot_id = p_slot, resolved_at = now() where application_id = p_app;
    return 'TRANSFERRED';

  elsif p_choice = 'KEEP_PASS' or (p_choice = 'REFUND' and ps.type <> 'SINGLE') then
    if ps.type <> 'SINGLE' then
      update passes set expires_at = expires_at + make_interval(days => v_ext), extended_days = extended_days + v_ext
       where id = ps.id;
    end if;
    update applications set match_status = 'NO_MATCH' where id = p_app;
    update match_resolutions set choice = 'KEEP_PASS', resolved_at = now() where application_id = p_app;
    return case when ps.type <> 'SINGLE' then 'MEMBERSHIP_EXTENDED' else 'PASS_KEPT' end;

  elsif p_choice = 'REFUND' then
    update applications set payment_status = 'REFUND_REQUESTED' where id = p_app;
    update applications set payment_status = 'REFUND_PROCESSING', match_status = 'NO_MATCH' where id = p_app;
    update payments set status = 'REFUNDED', refund_rate = 1.0, refund_amount = amount, refunded_at = now()
     where application_id = p_app and status = 'PAID';
    update applications set payment_status = 'REFUNDED' where id = p_app;
    update passes set remaining = 0 where id = ps.id;
    update match_resolutions set choice = 'REFUND', resolved_at = now() where application_id = p_app;
    return 'REFUNDED';
  end if;
  raise exception 'INVALID_CHOICE';
end $$;

-- ---------------------------------------------------------------------
-- STA-01: 매칭 전 신청 취소 (마감 전까지)
--   결제 대기 → 그냥 취소 / 1회권 결제 완료 → 전액 자동 환불 / 멤버십 → 기간 그대로
-- ---------------------------------------------------------------------
create or replace function cancel_application(p_app uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a applications%rowtype; v_amount int;
begin
  select * into a from applications where id = p_app and user_id = current_profile_id();
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.application_status <> 'SUBMITTED' or a.match_status not in ('WAITING', 'TRANSFERRED', 'REALLOCATING') then
    raise exception 'CANCEL_NOT_ALLOWED';
  end if;
  if exists (select 1 from application_slots x join event_slots e on e.id = x.slot_id
              where x.application_id = p_app and e.apply_deadline <= now()) then
    raise exception 'CANCEL_AFTER_DEADLINE';
  end if;

  perform set_config('app.actor', 'user:' || a.user_id, true);
  select amount into v_amount from payments where application_id = p_app and status = 'PAID' limit 1;
  if a.payment_status = 'PAID' and coalesce(v_amount, 0) > 0 then
    update applications set payment_status = 'REFUND_REQUESTED' where id = p_app;
    update applications set payment_status = 'REFUND_PROCESSING' where id = p_app;
    update payments set status = 'REFUNDED', refund_rate = 1.0, refund_amount = amount, refunded_at = now()
     where application_id = p_app and status = 'PAID';
    update applications set payment_status = 'REFUNDED' where id = p_app;
    update passes set remaining = 0 where id = a.pass_id and type = 'SINGLE';
  end if;
  update coupons set used_at = null where id = a.coupon_id;          -- 쓴 쿠폰은 돌려줌
  update applications set application_status = 'CANCELED', match_status = 'NO_MATCH', coupon_id = null where id = p_app;
  return 'CANCELED';
end $$;
revoke all on function cancel_application(uuid) from public, anon;
grant execute on function cancel_application(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- §14 알림 — 0013 + 신청 취소 안내
-- ---------------------------------------------------------------------
create or replace function app_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s record; pay payments%rowtype; t text; key text;
  add_noti text[] := '{}';
begin
  select e.starts_at, e.region_code, e.match_run_at, e.apply_deadline into s
    from application_slots x join event_slots e on e.id = x.slot_id
   where x.application_id = new.id order by e.starts_at limit 1;
  select * into pay from payments where application_id = new.id order by created_at desc limit 1;

  if new.application_status = 'SUBMITTED' and (tg_op = 'INSERT' or old.application_status is distinct from 'SUBMITTED') then
    add_noti := add_noti || 'APPLIED'::text;
    if new.payment_status = 'PENDING' then add_noti := add_noti || 'PAYMENT_PENDING'::text; end if;
  end if;
  if new.payment_status = 'PAID' and (tg_op = 'INSERT' or old.payment_status is distinct from 'PAID')
     and (tg_op = 'INSERT' or old.payment_status <> 'REFUND_AVAILABLE') then
    add_noti := add_noti || 'PAID'::text;
  end if;
  if tg_op = 'UPDATE' then
    if new.application_status = 'CANCELED' and old.application_status is distinct from 'CANCELED' then
      add_noti := add_noti || 'APP_CANCELED'::text;
    end if;
    if new.match_status = 'REALLOCATING' and old.match_status is distinct from 'REALLOCATING' then
      add_noti := add_noti || 'REALLOCATING'::text;
    end if;
    if new.match_status = 'ALTERNATIVE_OFFERED' and old.match_status is distinct from 'ALTERNATIVE_OFFERED' then
      add_noti := add_noti || 'MATCH_FAILED'::text;
    end if;
    if old.match_status = 'ALTERNATIVE_OFFERED' and new.match_status in ('WAITING', 'TRANSFERRED') then
      add_noti := add_noti || 'MOVED'::text;
    end if;
    if new.payment_status in ('REFUND_REQUESTED', 'REFUND_PROCESSING')
       and old.payment_status not in ('REFUND_REQUESTED', 'REFUND_PROCESSING', 'REFUNDED') then
      add_noti := add_noti || 'REFUND_REQUESTED'::text;
    end if;
    if new.payment_status = 'REFUNDED' and old.payment_status is distinct from 'REFUNDED' then
      add_noti := add_noti || 'REFUNDED'::text;
    end if;
  end if;

  foreach t in array add_noti loop
    key := t || ':' || new.id || case when t in ('MOVED', 'REALLOCATING') then ':' || coalesce(s.starts_at::text, '') else '' end;
    insert into notifications(user_id, template, payload, scheduled_at, dedupe_key)
    values (new.user_id, t,
            jsonb_build_object('application_id', new.id, 'starts_at', s.starts_at, 'region', s.region_code,
                               'match_run_at', s.match_run_at, 'deadline', s.apply_deadline,
                               'amount', coalesce(pay.refund_amount, pay.amount),
                               'reason', (select reason from match_resolutions where application_id = new.id)),
            now(), key)
    on conflict (dedupe_key) do nothing;
  end loop;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 매칭 결과 반영 — 0002 재정의
--   시작: 대상 신청 MATCHING → 확정 CONFIRMED / 다음 희망 날짜로 넘김 REALLOCATING / 실패 ALTERNATIVE_OFFERED(+사유)
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
  v_all      uuid[];
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
      insert into exception_cases(kind, reason)
      values ('CONFLICT', '자동 확정 실패: ' || sqlerrm || ' / slot ' || (t->>'slot_id'));
      update applications set match_status = 'EXCEPTION'
       where id in (select (jsonb_array_elements_text(t->'members'))::uuid);
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

-- ---------------------------------------------------------------------
-- MAT-07: 확정 직전 필수 조건 재검증 (인원·나이·제외 관계 + 결제 완료 + 희망 날짜·지역)
-- ---------------------------------------------------------------------
create or replace function validate_table_on_confirm() returns trigger
language plpgsql as $$
declare
  n int; age_gap int; conflicts int; max_gap int; bad int;
begin
  if new.status = 'CONFIRMED' and (old.status is distinct from 'CONFIRMED') then
    max_gap := coalesce((select (value->>'max_age_gap')::int from settings where key = 'matching'), 8);

    select count(*), max(p.birth_year) - min(p.birth_year) into n, age_gap
      from table_members m join profiles p on p.id = m.user_id where m.table_id = new.id;
    if n < 4 or n > 6 then raise exception 'TABLE_SIZE_INVALID: % members', n; end if;
    if age_gap > max_gap then raise exception 'AGE_GAP_EXCEEDED: % years', age_gap; end if;

    select count(*) into conflicts
      from table_members a
      join table_members b on a.table_id = b.table_id and a.user_id < b.user_id
      join excluded_pairs x on x.u1 = a.user_id and x.u2 = b.user_id
     where a.table_id = new.id;
    if conflicts > 0 then raise exception 'EXCLUDED_PAIR_PRESENT: % pairs', conflicts; end if;

    select count(*) into bad
      from table_members m join applications a on a.id = m.application_id
     where m.table_id = new.id and a.payment_status <> 'PAID';
    if bad > 0 then raise exception 'UNPAID_MEMBER: %', bad; end if;

    select count(*) into bad
      from table_members m
     where m.table_id = new.id and m.application_id is not null
       and not exists (select 1 from application_slots x where x.application_id = m.application_id and x.slot_id = new.slot_id);
    if bad > 0 then raise exception 'SLOT_NOT_CHOSEN: %', bad; end if;

    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- SAF-02: 처리대기함의 신고 건 ↔ 실제 신고 1:1 연결
-- ---------------------------------------------------------------------
alter table exception_cases add column if not exists report_id uuid references safety_reports(id);

create or replace function link_safety_report() returns trigger
language plpgsql as $$
begin
  if new.kind = 'SAFETY' and new.report_id is null then
    new.report_id := (select r.id from safety_reports r
                       where r.table_id = new.table_id and r.status = 'OPEN'
                         and not exists (select 1 from exception_cases e where e.report_id = r.id)
                       order by r.created_at desc limit 1);
  end if;
  return new;
end $$;
drop trigger if exists trg_link_safety_report on exception_cases;
create trigger trg_link_safety_report before insert on exception_cases
for each row execute function link_safety_report();

-- 기존 건 연결
update exception_cases e set report_id = (
  select r.id from safety_reports r where r.table_id = e.table_id
     and not exists (select 1 from exception_cases e2 where e2.report_id = r.id)
   order by abs(extract(epoch from r.created_at - e.created_at)) limit 1)
 where e.kind = 'SAFETY' and e.report_id is null;

create or replace function admin_safety_action(p_exception uuid, p_action text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e exception_cases%rowtype; rep safety_reports%rowtype;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_action not in ('WARNING', 'RESTRICTED', 'BANNED', 'DISMISSED') then raise exception 'INVALID_ACTION'; end if;
  select * into e from exception_cases where id = p_exception and kind = 'SAFETY';
  if e.id is null then raise exception 'NOT_FOUND'; end if;
  select * into rep from safety_reports where id = e.report_id;

  perform set_config('app.actor', 'admin:' || current_profile_id(), true);
  if rep.id is not null then
    update safety_reports set status = 'RESOLVED', admin_action = p_action where id = rep.id;
    if p_action = 'RESTRICTED' then
      update profiles set restricted_until = greatest(coalesce(restricted_until, now()), now() + interval '30 days') where id = rep.reported_id;
    elsif p_action = 'BANNED' then
      update profiles set restricted_until = 'infinity' where id = rep.reported_id;
    end if;
  end if;
  update exception_cases
     set status = 'RESOLVED', resolved_at = now(),
         admin_note = case p_action when 'WARNING' then '경고' when 'RESTRICTED' then '30일 참가 제한'
                                    when 'BANNED' then '영구 제한' else '조치 없음' end
                      || coalesce(' · ' || nullif(trim(p_note), ''), '')
   where id = e.id;
  return p_action;
end $$;

create or replace function admin_safety_detail(p_exception uuid)
returns table(reporter text, reported text, reason text, reported_restricted_until timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.name, pd.name, r.reason, pd.restricted_until
    from exception_cases e
    join safety_reports r on r.id = e.report_id
    join profiles pr on pr.id = r.reporter_id
    join profiles pd on pd.id = r.reported_id
   where e.id = p_exception and e.kind = 'SAFETY' and is_admin();
$$;

-- ---------------------------------------------------------------------
-- §16 운영 추적: 주요 상태 변경을 audit_log 에 (누가·언제·무엇을·이전 값)
-- ---------------------------------------------------------------------
create or replace function audit_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor text := coalesce(nullif(current_setting('app.actor', true), ''),
                         case when current_user in ('authenticated', 'anon')
                              then (case when is_admin() then 'admin:' else 'user:' end) || coalesce(current_profile_id()::text, '?')
                              else 'system:' || current_user end);
  col text; ov text; nv text; eid uuid;
begin
  foreach col in array tg_argv loop
    execute format('select ($1).%I::text, ($2).%I::text', col, col) using old, new into ov, nv;
    if ov is distinct from nv then
      if tg_table_name = 'table_members' then eid := new.table_id; nv := nv || ' (user ' || new.user_id || ')'; else eid := new.id; end if;
      insert into audit_log(entity, entity_id, field, old_value, new_value, actor)
      values (tg_table_name, eid,
              col, ov, nv, actor);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_audit_profiles on profiles;
create trigger trg_audit_profiles after update on profiles
for each row execute function audit_changes('role', 'restricted_until', 'deleted_at');
drop trigger if exists trg_audit_members on table_members;
create trigger trg_audit_members after update on table_members
for each row execute function audit_changes('attendance');
drop trigger if exists trg_audit_payments on payments;
create trigger trg_audit_payments after update on payments
for each row execute function audit_changes('status', 'refund_amount');
drop trigger if exists trg_audit_slots on event_slots;
create trigger trg_audit_slots after update on event_slots
for each row execute function audit_changes('is_open', 'capacity', 'apply_deadline', 'match_run_at');
drop trigger if exists trg_audit_venues on venues;
create trigger trg_audit_venues after update on venues
for each row execute function audit_changes('is_active', 'is_reservable');
drop trigger if exists trg_audit_exceptions on exception_cases;
create trigger trg_audit_exceptions after update on exception_cases
for each row execute function audit_changes('status', 'admin_note');
drop trigger if exists trg_audit_reports on safety_reports;
create trigger trg_audit_reports after update on safety_reports
for each row execute function audit_changes('status', 'admin_action');
drop trigger if exists trg_audit_tables on dining_tables;
create trigger trg_audit_tables after update on dining_tables
for each row execute function audit_changes('status', 'venue_id');

-- 설정 변경 이력 (settings 는 key 가 text 라 별도 테이블)
create table if not exists settings_history (
  id bigint generated always as identity primary key,
  key text not null, old_value jsonb, new_value jsonb, actor text not null, at timestamptz not null default now()
);
alter table settings_history enable row level security;
drop policy if exists admin_settings_history on settings_history;
create policy admin_settings_history on settings_history for select using (is_admin());

create or replace function audit_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.value is distinct from new.value then
    insert into settings_history(key, old_value, new_value, actor)
    values (new.key, case when tg_op = 'UPDATE' then old.value end, new.value,
            case when current_user in ('authenticated', 'anon') then 'admin:' || coalesce(current_profile_id()::text, '?') else 'system' end);
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_settings on settings;
create trigger trg_audit_settings after insert or update on settings
for each row execute function audit_settings();

-- ---------------------------------------------------------------------
-- 탈퇴 — 0013 + 이동·재배치 대기 상태 포함
-- ---------------------------------------------------------------------
create or replace function delete_my_account() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := current_profile_id(); v_auth uuid := auth.uid();
begin
  if me is null then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from table_members m join dining_tables t on t.id = m.table_id join event_slots s on s.id = t.slot_id
              where m.user_id = me and t.status = 'CONFIRMED' and m.attendance = 'SCHEDULED' and s.starts_at > now()) then
    raise exception 'HAS_UPCOMING_TABLE';
  end if;
  if exists (select 1 from applications where user_id = me and application_status = 'SUBMITTED'
              and payment_status in ('PAID', 'REFUND_AVAILABLE')
              and match_status in ('WAITING', 'TRANSFERRED', 'REALLOCATING', 'MATCHING', 'ALTERNATIVE_OFFERED')) then
    raise exception 'HAS_PENDING_APPLICATION';
  end if;
  perform set_config('app.actor', 'user:' || me, true);
  update applications set application_status = 'CANCELED'
   where user_id = me and application_status = 'SUBMITTED' and payment_status = 'PENDING';
  delete from region_waitlist where profile_id = me;
  update profiles set name = '탈퇴한 회원', phone = null, job = null, allergies = '{}', food_dislikes = '{}',
                      budget_ranges = '{}', auth_user_id = null, deleted_at = now()
   where id = me;
  delete from auth.users where id = v_auth;
  return 'DELETED';
end $$;
