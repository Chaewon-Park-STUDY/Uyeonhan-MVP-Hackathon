-- =====================================================================
-- 0004: 참가자 앱 (PRD 6.1~6.3, STA-04~06, PAY-01~03)
--   참가자가 상태를 직접 바꾸는 동작은 모두 소유자 검증을 하는 함수로만 허용한다.
--   (결제 완료, 환불, 매칭 상태를 클라이언트가 임의로 쓰지 못하게)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 프로필 RLS: 로그인 계정(auth_user_id) 기준
-- ---------------------------------------------------------------------
drop policy if exists own_profile on profiles;
drop policy if exists profile_select on profiles;
create policy profile_select on profiles for select using (auth_user_id = auth.uid() or is_admin());
drop policy if exists profile_update on profiles;
create policy profile_update on profiles for update using (auth_user_id = auth.uid() or is_admin())
  with check (auth_user_id = auth.uid() or is_admin());

-- 신청·결제·이용권은 함수로만 쓴다 (읽기는 본인 것만)
drop policy if exists own_app on applications;
drop policy if exists app_select on applications;
create policy app_select on applications for select using (user_id = current_profile_id() or is_admin());
drop policy if exists own_app_slots on application_slots;
drop policy if exists app_slots_select on application_slots;
create policy app_slots_select on application_slots for select
  using (exists (select 1 from applications a where a.id = application_id and (a.user_id = current_profile_id() or is_admin())));
drop policy if exists own_resolution on match_resolutions;
drop policy if exists resolution_select on match_resolutions;
create policy resolution_select on match_resolutions for select
  using (exists (select 1 from applications a where a.id = application_id and (a.user_id = current_profile_id() or is_admin())));

-- 같은 테이블 멤버의 공개 소개 (이름 첫 글자, 연령대, MBTI, 관심사 — 연락처·출생연도·성별 등은 비공개, PRD INF-06)
create or replace function table_intro(p_table_id uuid)
returns table(nickname text, age_band text, mbti text, interests text[])
language sql stable security definer set search_path = public as $$
  select left(p.name, 1) || '○○',
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id
     and exists (select 1 from dining_tables t where t.id = p_table_id and t.status = 'CONFIRMED')
     and (is_table_member(p_table_id) or is_admin());
$$;

-- ---------------------------------------------------------------------
-- 프로필 저장 (ACC-01~05)
-- ---------------------------------------------------------------------
create or replace function upsert_my_profile(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  if coalesce((p->>'privacy_agreed')::boolean, false) is not true then raise exception 'PRIVACY_CONSENT_REQUIRED'; end if;

  insert into profiles(auth_user_id, name, phone, birth_year, gender, job, mbti, interests, self_traits,
                       desired_traits, allergies, food_dislikes, budget_ranges, default_fail_pref, privacy_agreed_at)
  values (auth.uid(), p->>'name', p->>'phone', (p->>'birth_year')::int, (p->>'gender')::gender_t, p->>'job',
          nullif(upper(p->>'mbti'), ''),
          array(select jsonb_array_elements_text(coalesce(p->'interests', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p->'self_traits', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p->'desired_traits', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p->'allergies', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p->'food_dislikes', '[]'))),
          array(select jsonb_array_elements_text(coalesce(p->'budget_ranges', '[]'))),
          coalesce((p->>'default_fail_pref')::fail_preference, 'MOVE_DATE'), now())
  on conflict (auth_user_id) do update set
    name = excluded.name, phone = excluded.phone, birth_year = excluded.birth_year, gender = excluded.gender,
    job = excluded.job, mbti = excluded.mbti, interests = excluded.interests, self_traits = excluded.self_traits,
    desired_traits = excluded.desired_traits, allergies = excluded.allergies, food_dislikes = excluded.food_dislikes,
    budget_ranges = excluded.budget_ranges, default_fail_pref = excluded.default_fail_pref, updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 신청 (APP-01~04, PAY-02): 회차 복수 선택 + 이용권 + 실패 시 선택지
-- 유효한 멤버십이 있으면 결제 없이 바로 PAID
-- ---------------------------------------------------------------------
create or replace function submit_application(p_slot_ids uuid[], p_pass_type pass_type, p_fail_pref fail_preference,
                                              p_coupon_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me profiles%rowtype;
  v_app uuid; v_pass uuid; v_price int; v_discount int := 0; v_rate numeric; v_member passes%rowtype;
  v_pricing jsonb := (select value from settings where key = 'pricing');
begin
  select * into me from profiles where auth_user_id = auth.uid();
  if me.id is null then raise exception 'PROFILE_REQUIRED'; end if;
  if me.restricted_until is not null and me.restricted_until > now() then
    raise exception 'RESTRICTED_UNTIL %', to_char(me.restricted_until at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  end if;
  if coalesce(array_length(p_slot_ids, 1), 0) = 0 then raise exception 'NO_SLOT_SELECTED'; end if;
  if exists (select 1 from unnest(p_slot_ids) s(id) left join event_slots e on e.id = s.id
             where e.id is null or not e.is_open or e.apply_deadline <= now()) then
    raise exception 'SLOT_CLOSED';
  end if;
  if exists (select 1 from applications a join application_slots s on s.application_id = a.id
             where a.user_id = me.id and a.application_status = 'SUBMITTED'
               and a.match_status in ('WAITING', 'CONFIRMED') and s.slot_id = any(p_slot_ids)) then
    raise exception 'ALREADY_APPLIED';
  end if;

  perform set_config('app.actor', 'user:' || me.id, true);

  -- 사용 가능한 멤버십
  select * into v_member from passes
   where user_id = me.id and type <> 'SINGLE' and expires_at > now()
   order by expires_at desc limit 1;

  if v_member.id is not null then
    v_pass := v_member.id; v_price := 0;
  else
    v_price := (v_pricing->p_pass_type::text->>'price')::int;
    if v_price is null then raise exception 'INVALID_PASS_TYPE'; end if;
    insert into passes(user_id, type, remaining, expires_at)
    values (me.id, p_pass_type,
            case when p_pass_type = 'SINGLE' then 1 end,
            case when p_pass_type <> 'SINGLE'
                 then now() + make_interval(months => (v_pricing->p_pass_type::text->>'months')::int) end)
    returning id into v_pass;
    if p_coupon_id is not null then
      select discount_rate into v_rate from coupons
       where id = p_coupon_id and user_id = me.id and used_at is null and expires_at > now();
      if v_rate is null then raise exception 'INVALID_COUPON'; end if;
      v_discount := round(v_price * v_rate);
    end if;
  end if;

  insert into applications(user_id, pass_id, coupon_id, fail_pref, application_status, payment_status, submitted_at)
  values (me.id, v_pass, case when v_discount > 0 then p_coupon_id end, p_fail_pref, 'SUBMITTED',
          case when v_price = 0 then 'PAID'::payment_status else 'PENDING'::payment_status end, now())
  returning id into v_app;

  insert into application_slots(application_id, slot_id) select v_app, unnest(p_slot_ids);

  insert into payments(application_id, amount, discount_amount, method, status, idempotency_key)
  values (v_app, v_price - v_discount, v_discount, case when v_price = 0 then 'MEMBERSHIP' else 'MOCK' end,
          case when v_price = 0 then 'PAID'::payment_status else 'PENDING'::payment_status end, 'pay-' || v_app);
  return v_app;
end $$;

-- ---------------------------------------------------------------------
-- 모의 결제 (PAY-01): 해커톤에서는 버튼 = 결제 완료. 같은 신청에 두 번 눌러도 한 번만 처리
-- ---------------------------------------------------------------------
create or replace function mock_pay(p_app uuid) returns text
language plpgsql security definer set search_path = public as $$
declare a applications%rowtype;
begin
  select * into a from applications where id = p_app and user_id = current_profile_id();
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.payment_status = 'PAID' then return 'ALREADY_PAID'; end if;
  if a.payment_status <> 'PENDING' then raise exception 'INVALID_STATE %', a.payment_status; end if;

  perform set_config('app.actor', 'user:' || a.user_id, true);
  update payments set status = 'PAID' where application_id = p_app and status = 'PENDING';
  update applications set payment_status = 'PAID' where id = p_app;
  update coupons set used_at = now() where id = a.coupon_id and used_at is null;
  return 'PAID';
end $$;

-- ---------------------------------------------------------------------
-- 매칭 실패 해결 (STA-05, STA-06, PAY-03)
--   MOVE_DATE / MOVE_REGION : 제안된 회차로 이동, 기존 결제 유지, 새 회차 매칭 대기
--   KEEP_PASS               : 이용권 보관 (멤버십은 기간 7일 연장)
--   REFUND                  : 1회권 100% 자동 환불 (모의). 멤버십은 환불 대신 기간 연장 (FAQ Q5)
-- resolve_internal: 소유자 검증 없는 내부용 / resolve_match: 참가자용 (소유자 검증)
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
    update applications set match_status = 'WAITING', assigned_slot_id = null where id = p_app;
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

create or replace function resolve_match(p_app uuid, p_choice fail_preference, p_slot uuid default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from applications where id = p_app and user_id = current_profile_id()) then
    raise exception 'NOT_FOUND';
  end if;
  perform set_config('app.actor', 'user:' || current_profile_id(), true);
  return resolve_internal(p_app, p_choice, p_slot);
end $$;

-- ---------------------------------------------------------------------
-- 신청 때 미리 고른 선택지 자동 적용 (매칭 실패 순간 = match_resolutions 생성 시)
--   MOVE_DATE   : 제안 회차 중 원래와 다른 날짜의 가장 이른 회차
--   MOVE_REGION : 제안 회차 중 원래와 같은 날짜의 다른 지역
--   KEEP_PASS / REFUND : 바로 처리
-- 조건에 맞는 회차가 없으면 자동 처리하지 않고 참가자의 직접 선택을 기다린다.
-- ---------------------------------------------------------------------
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

drop trigger if exists trg_auto_prechoice on match_resolutions;
create trigger trg_auto_prechoice after insert on match_resolutions
for each row execute function auto_apply_prechoice();

revoke all on function resolve_internal(uuid, fail_preference, uuid), auto_apply_prechoice() from public, anon, authenticated;
revoke all on function upsert_my_profile(jsonb), submit_application(uuid[], pass_type, fail_preference, uuid),
                       mock_pay(uuid), resolve_match(uuid, fail_preference, uuid), table_intro(uuid)
  from public, anon;
grant execute on function upsert_my_profile(jsonb), submit_application(uuid[], pass_type, fail_preference, uuid),
                          mock_pay(uuid), resolve_match(uuid, fail_preference, uuid), table_intro(uuid)
  to authenticated;
