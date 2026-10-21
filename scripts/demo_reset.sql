-- =====================================================================
-- 데모 계정 초기화 (Supabase SQL Editor에서 실행, 여러 번 실행해도 안전)
--   demo.new         : 프로필·신청·결제 기록을 모두 지워 "처음 가입한 상태"로
--   demo.alternative : "다른 일정 선택 필요" 상태로 되돌리고, 지금 신청 가능한 회차를 다시 제안
--   demo.matched     : 확정 테이블은 그대로, 체크인·취소·피드백·쿠폰 기록만 지움 (피드백 시연을 다시 할 수 있게)
-- 심사 제출 직전에 한 번 실행한다.
-- =====================================================================
do $$
declare
  v_new uuid := (select p.id from profiles p join auth.users u on u.id = p.auth_user_id
                  where u.email = 'demo.new@uyeonhan.kr');
  v_alt uuid := (select p.id from profiles p join auth.users u on u.id = p.auth_user_id
                  where u.email = 'demo.alternative@uyeonhan.kr');
  v_mat uuid := (select p.id from profiles p join auth.users u on u.id = p.auth_user_id
                  where u.email = 'demo.matched@uyeonhan.kr');
  v_app uuid;
begin
  perform set_config('app.actor', 'admin:demo_reset', true);

  -- demo.new: 전부 삭제 ------------------------------------------------------
  if v_new is not null then
    delete from table_members      where user_id = v_new;
    delete from match_resolutions  where application_id in (select id from applications where user_id = v_new);
    delete from exception_cases    where application_id in (select id from applications where user_id = v_new);
    delete from payments           where application_id in (select id from applications where user_id = v_new);
    delete from applications       where user_id = v_new;          -- application_slots 는 cascade
    delete from passes             where user_id = v_new;
    delete from coupons            where user_id = v_new;
    delete from notifications      where user_id = v_new;
    delete from profiles           where id = v_new;
  end if;

  -- demo.matched: 모임 전 상태로 -----------------------------------------------
  if v_mat is not null then
    update table_members set attendance = 'SCHEDULED', checked_in_at = null, canceled_at = null where user_id = v_mat;
    delete from feedback           where user_id = v_mat;
    delete from person_preferences where from_user = v_mat;
    delete from attendance_votes   where voter_id = v_mat;
    delete from blocks             where blocker_id = v_mat;
    delete from exception_cases    where kind = 'SAFETY' and table_id in (select table_id from safety_reports where reporter_id = v_mat);
    delete from safety_reports     where reporter_id = v_mat;
    delete from coupons            where user_id = v_mat and kind = 'REVISIT';
    delete from chat_messages      where sender_id = v_mat;
    delete from chat_messages      where sender_id is null and content like '%님이 도착했어요%'
                                     and room_id in (select c.id from chat_rooms c join table_members m on m.table_id = c.table_id where m.user_id = v_mat);
    delete from exception_cases    where reason like '취소로 테이블 인원이%'
                                     and table_id in (select table_id from table_members where user_id = v_mat);
  end if;

  -- demo.alternative: 매칭 실패 직후 상태로 ----------------------------------
  if v_alt is not null then
    select application_id into v_app from match_resolutions r
      join applications a on a.id = r.application_id
     where a.user_id = v_alt order by a.created_at limit 1;

    -- 원래 신청 외에 테스트하며 새로 만든 신청은 삭제
    delete from match_resolutions where application_id in (select id from applications where user_id = v_alt and id <> v_app);
    delete from payments          where application_id in (select id from applications where user_id = v_alt and id <> v_app);
    delete from applications      where user_id = v_alt and id <> v_app;
    delete from passes ps where ps.user_id = v_alt
      and not exists (select 1 from applications a where a.pass_id = ps.id);

    update applications set match_status = 'ALTERNATIVE_OFFERED', application_status = 'SUBMITTED', assigned_slot_id = null,
           payment_status = case when (select type from passes where id = pass_id) = 'SINGLE' then 'REFUND_AVAILABLE'::payment_status
                                 else 'PAID'::payment_status end
     where id = v_app;
    update payments set status = 'PAID', refund_rate = null, refund_amount = null, refunded_at = null
     where application_id = v_app;
    update passes set remaining = 1 where id = (select pass_id from applications where id = v_app) and type = 'SINGLE';
    update match_resolutions
       set choice = null, chosen_slot_id = null, resolved_at = null,
           reason = '나이 조건: 나이 차이 8살 이내로 4명 이상 모이는 조합이 없었어요',
           offered_slots = coalesce((select array_agg(id) from (
                              select id from event_slots
                               where is_open and apply_deadline > now()
                               order by starts_at, region_code limit 3) s), '{}')
     where application_id = v_app;
  end if;
end $$;

-- 확인
select u.email, p.name, a.match_status, a.payment_status, cardinality(r.offered_slots) as offered
  from auth.users u
  left join profiles p on p.auth_user_id = u.id
  left join applications a on a.user_id = p.id
  left join match_resolutions r on r.application_id = a.id
 where u.email like 'demo.%@uyeonhan.kr'
 order by u.email;
