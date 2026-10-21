-- =====================================================================
-- 0020: 참가자 화면 2차 검토 반영
--   보관 이용권(0원)으로 신청한 건은 '환불'을 골라도 이용권 보관으로 (이용권 분실 방지)
--   같은 회차 중복 신청 방지 범위 확대 (이동·재배치·결제 대기 포함)
--   좌석을 취소한 사람: 남은 리마인드·피드백 요청 알림 취소, 단체방 글쓰기 불가
--   단체방 명단에 '취소함' 표시 (피드백 사람 목록·신고 대상에서 제외용)
-- 다시 실행해도 안전
-- =====================================================================

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

  -- 보관 이용권·멤버십처럼 결제 금액이 0원이면 '환불' 대신 이용권을 보관 (0원 환불로 이용권을 잃지 않게)
  elsif p_choice = 'KEEP_PASS' or (p_choice = 'REFUND' and (ps.type <> 'SINGLE'
        or coalesce((select sum(amount) from payments where application_id = p_app and status = 'PAID'), 0) = 0)) then
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
               and a.match_status not in ('NO_MATCH') and s.slot_id = any(p_slot_ids)) then
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


-- 좌석 취소 → 그 사람에게 예약된 리마인드·피드백 알림 취소
create or replace function drop_notis_on_cancel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.attendance in ('CANCELED_EARLY', 'CANCELED_LATE') and old.attendance is distinct from new.attendance then
    delete from notifications
     where user_id = new.user_id and sent_at is null and (payload->>'table_id')::uuid = new.table_id
       and template in ('REMINDER_D1', 'REMINDER_D0', 'FEEDBACK_REQUEST', 'FEEDBACK_REMINDER');
  end if;
  return new;
end $$;
drop trigger if exists trg_drop_notis_on_cancel on table_members;
create trigger trg_drop_notis_on_cancel after update of attendance on table_members
for each row execute function drop_notis_on_cancel();

-- 취소한 사람은 단체방에 글을 쓸 수 없음 (읽기는 가능)
drop policy if exists member_msgs_w on chat_messages;
create policy member_msgs_w on chat_messages for insert with check (
  sender_id = current_profile_id()
  and exists (select 1 from chat_rooms r join table_members m on m.table_id = r.table_id
               where r.id = room_id and m.user_id = current_profile_id()
                 and m.attendance not in ('CANCELED_EARLY', 'CANCELED_LATE')));

-- 단체방 명단: 취소 여부 함께
drop function if exists table_roster(uuid);
create function table_roster(p_table_id uuid)
returns table(profile_id uuid, nickname text, is_me boolean, age_band text, mbti text, interests text[], animals text[], canceled boolean)
language sql stable security definer set search_path = public as $$
  select p.id, left(p.name, 1) || '○○', p.id = current_profile_id(),
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests, p.self_traits, m.attendance in ('CANCELED_EARLY', 'CANCELED_LATE')
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id and (is_table_member(p_table_id) or is_admin());
$$;
revoke all on function table_roster(uuid) from public, anon;
grant execute on function table_roster(uuid) to authenticated;
