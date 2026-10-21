-- =====================================================================
-- 0019: 친구 초대 (추천 코드)
--   초대받은 사람: 코드를 넣으면 바로 첫 신청 할인 쿠폰
--   초대한 사람 : 친구가 처음 결제를 마치면 할인 쿠폰 (한 친구당 1장)
--   자기 코드·두 번 입력·이미 모임에 참가해 본 사람은 불가
-- 다시 실행해도 안전
-- =====================================================================
insert into settings(key, value)
values ('referral', '{"new_rate": 0.1, "inviter_rate": 0.1, "valid_days": 30}')
on conflict (key) do nothing;

create or replace function apply_referral(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; inviter uuid; cfg jsonb := (select value from settings where key = 'referral');
begin
  select * into me from profiles where id = current_profile_id();
  if me.id is null then raise exception 'PROFILE_REQUIRED'; end if;
  if me.referred_by is not null then raise exception 'REFERRAL_ALREADY'; end if;
  select id into inviter from profiles where referral_code = lower(trim(p_code)) and deleted_at is null;
  if inviter is null then raise exception 'REFERRAL_NOT_FOUND'; end if;
  if inviter = me.id then raise exception 'REFERRAL_SELF'; end if;
  if exists (select 1 from table_members where user_id = me.id) then raise exception 'REFERRAL_NOT_NEW'; end if;

  update profiles set referred_by = inviter where id = me.id;
  insert into coupons(user_id, kind, discount_rate, expires_at, source_ref)
  values (me.id, 'REFERRAL_NEW', coalesce((cfg->>'new_rate')::numeric, 0.1),
          now() + make_interval(days => coalesce((cfg->>'valid_days')::int, 30)), inviter)
  on conflict do nothing;
  return 'OK';
end $$;
revoke all on function apply_referral(text) from public, anon;
grant execute on function apply_referral(text) to authenticated;

-- 친구가 처음 결제를 마치면 초대한 사람에게 쿠폰
create or replace function referral_reward() returns trigger
language plpgsql security definer set search_path = public as $$
declare inviter uuid; cfg jsonb := (select value from settings where key = 'referral');
begin
  if new.payment_status = 'PAID' and old.payment_status is distinct from 'PAID' then
    select referred_by into inviter from profiles where id = new.user_id;
    if inviter is not null then
      insert into coupons(user_id, kind, discount_rate, expires_at, source_ref)
      values (inviter, 'REFERRAL_INVITER', coalesce((cfg->>'inviter_rate')::numeric, 0.1),
              now() + make_interval(days => coalesce((cfg->>'valid_days')::int, 30)), new.user_id)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_referral_reward on applications;
create trigger trg_referral_reward after update of payment_status on applications
for each row execute function referral_reward();

-- 내 초대 현황
create or replace function my_referral()
returns table(code text, invited bigint, rewarded bigint, referred boolean, can_enter boolean)
language sql stable security definer set search_path = public as $$
  select p.referral_code,
         (select count(*) from profiles x where x.referred_by = p.id),
         (select count(*) from coupons c where c.user_id = p.id and c.kind = 'REFERRAL_INVITER'),
         p.referred_by is not null,
         p.referred_by is null and not exists (select 1 from table_members m where m.user_id = p.id)
    from profiles p where p.id = current_profile_id();
$$;
revoke all on function my_referral() from public, anon;
grant execute on function my_referral() to authenticated;
