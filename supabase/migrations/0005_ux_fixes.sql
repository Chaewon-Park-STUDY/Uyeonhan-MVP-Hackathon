-- =====================================================================
-- 0005: 참가자 테스트에서 나온 수정 (2026-10-19)
--   1) 매칭이 실행된 날짜의 회차는 자동 마감 (이미 끝난 회차에 신청 → 영원히 대기 방지)
--   2) 보관한 1회권(KEEP_PASS)은 다음 신청 때 결제 없이 자동 사용
--   3) table_intro 에 본인 표시(is_me)
--   4) my_credit(): 신청 화면에서 "결제 없이 신청돼요" 안내용
-- 다시 실행해도 안전 (create or replace / drop if exists)
-- =====================================================================

-- 1) 매칭 실행 = 그 날짜(KST) 회차 마감 --------------------------------------
create or replace function close_slots_on_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update event_slots set is_open = false
   where (starts_at at time zone 'Asia/Seoul')::date = new.run_key::date and is_open;
  return new;
exception when others then
  return new;          -- run_key 가 날짜 형식이 아니면 건너뜀
end $$;

drop trigger if exists trg_close_slots_on_run on match_runs;
create trigger trg_close_slots_on_run after insert on match_runs
for each row execute function close_slots_on_run();

-- 이미 실행된 날짜도 지금 마감
update event_slots e set is_open = false
 where e.is_open
   and exists (select 1 from match_runs r
                where r.run_key ~ '^\d{4}-\d{2}-\d{2}$'
                  and r.run_key::date = (e.starts_at at time zone 'Asia/Seoul')::date);

-- 2) 보관 이용권 ---------------------------------------------------------------
-- 보관 이용권 = 1회권 중 남은 횟수가 있고, 매칭 종료(NO_MATCH)+결제 완료 신청에만 쓰였으며,
--               진행 중이거나 확정된 신청에 묶여 있지 않은 것
create or replace function kept_pass_id(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select ps.id from passes ps
   where ps.user_id = p_user and ps.type = 'SINGLE' and coalesce(ps.remaining, 0) > 0
     and exists (select 1 from applications a
                  where a.pass_id = ps.id and a.match_status = 'NO_MATCH' and a.payment_status = 'PAID')
     and not exists (select 1 from applications a
                      where a.pass_id = ps.id
                        and (a.match_status <> 'NO_MATCH' or a.payment_status <> 'PAID')
                        and a.application_status = 'SUBMITTED')
   order by ps.created_at limit 1;
$$;

create or replace function my_credit() returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from passes where user_id = current_profile_id() and type <> 'SINGLE' and expires_at > now())
      then 'MEMBERSHIP'
    when kept_pass_id(current_profile_id()) is not null then 'KEPT_PASS'
  end;
$$;

create or replace function submit_application(p_slot_ids uuid[], p_pass_type pass_type, p_fail_pref fail_preference,
                                              p_coupon_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me profiles%rowtype;
  v_app uuid; v_pass uuid; v_price int; v_discount int := 0; v_rate numeric; v_member passes%rowtype;
  v_method text := 'MOCK';
  v_pricing jsonb := (select value from settings where key = 'pricing');
begin
  select * into me from profiles where auth_user_id = auth.uid();
  if me.id is null then raise exception 'PROFILE_REQUIRED'; end if;
  if me.restricted_until is not null and me.restricted_until > now() then
    raise exception 'RESTRICTED_UNTIL %', to_char(me.restricted_until at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  end if;
  if coalesce(array_length(p_slot_ids, 1), 0) = 0 then raise exception 'NO_SLOT_SELECTED'; end if;
  if exists (select 1 from unnest(p_slot_ids) s(id) left join event_slots e on e.id = s.id
             where e.id is null or not e.is_open or e.apply_deadline <= now()
                or exists (select 1 from match_runs r where r.run_key ~ '^\d{4}-\d{2}-\d{2}$'
                             and r.run_key::date = (e.starts_at at time zone 'Asia/Seoul')::date)) then
    raise exception 'SLOT_CLOSED';
  end if;
  if exists (select 1 from applications a join application_slots s on s.application_id = a.id
             where a.user_id = me.id and a.application_status = 'SUBMITTED'
               and a.match_status in ('WAITING', 'CONFIRMED') and s.slot_id = any(p_slot_ids)) then
    raise exception 'ALREADY_APPLIED';
  end if;

  perform set_config('app.actor', 'user:' || me.id, true);

  select * into v_member from passes
   where user_id = me.id and type <> 'SINGLE' and expires_at > now()
   order by expires_at desc limit 1;

  if v_member.id is not null then
    v_pass := v_member.id; v_price := 0; v_method := 'MEMBERSHIP';
  else
    v_pass := kept_pass_id(me.id);
    if v_pass is not null then
      v_price := 0; v_method := 'KEPT_PASS';            -- 보관 1회권 재사용
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
  end if;

  insert into applications(user_id, pass_id, coupon_id, fail_pref, application_status, payment_status, submitted_at)
  values (me.id, v_pass, case when v_discount > 0 then p_coupon_id end, p_fail_pref, 'SUBMITTED',
          case when v_price = 0 then 'PAID'::payment_status else 'PENDING'::payment_status end, now())
  returning id into v_app;

  insert into application_slots(application_id, slot_id) select v_app, unnest(p_slot_ids);

  insert into payments(application_id, amount, discount_amount, method, status, idempotency_key)
  values (v_app, v_price - v_discount, v_discount, v_method,
          case when v_price = 0 then 'PAID'::payment_status else 'PENDING'::payment_status end, 'pay-' || v_app);
  return v_app;
end $$;

-- 3) 테이블 소개에 본인 표시 -----------------------------------------------------
drop function if exists table_intro(uuid);
create function table_intro(p_table_id uuid)
returns table(nickname text, age_band text, mbti text, interests text[], is_me boolean)
language sql stable security definer set search_path = public as $$
  select left(p.name, 1) || '○○',
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests, p.id = current_profile_id()
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id
     and exists (select 1 from dining_tables t where t.id = p_table_id and t.status = 'CONFIRMED')
     and (is_table_member(p_table_id) or is_admin())
   order by (p.id = current_profile_id()) desc;
$$;

revoke all on function kept_pass_id(uuid), close_slots_on_run() from public, anon, authenticated;
revoke all on function my_credit(), table_intro(uuid), submit_application(uuid[], pass_type, fail_preference, uuid)
  from public, anon;
grant execute on function my_credit(), table_intro(uuid), submit_application(uuid[], pass_type, fail_preference, uuid)
  to authenticated;
