-- =====================================================================
-- 심사용 테스트 계정 연결 (Supabase SQL Editor에서 실행)
-- 먼저 Authentication → Users → Add user 로 아래 3개 계정을 만든다 (Auto Confirm 체크)
--   demo.new@uyeonhan.kr        : 새 참가자 — 프로필 작성부터 신청·결제까지 직접 체험
--   demo.matched@uyeonhan.kr    : 매칭 확정된 참가자 — 테이블·함께할 사람 소개 확인
--   demo.alternative@uyeonhan.kr: 매칭 실패 참가자 — 대체 회차·보관·환불 선택 체험
-- 그다음 이 파일을 실행하면 시드 신청자 중 해당 상태인 사람과 계정이 연결된다.
-- =====================================================================

-- 매칭 확정된 시드 참가자 1명 ↔ demo.matched
update profiles set auth_user_id = null
 where auth_user_id = (select id from auth.users where email = 'demo.matched@uyeonhan.kr');
update profiles set auth_user_id = (select id from auth.users where email = 'demo.matched@uyeonhan.kr')
 where id = (select a.user_id from applications a
              where a.match_status = 'CONFIRMED'
                and not exists (select 1 from profiles p where p.id = a.user_id and p.auth_user_id is not null)
              order by a.created_at limit 1);

-- 매칭 실패(대체 회차 제안) 시드 참가자 1명 ↔ demo.alternative
update profiles set auth_user_id = null
 where auth_user_id = (select id from auth.users where email = 'demo.alternative@uyeonhan.kr');
update profiles set auth_user_id = (select id from auth.users where email = 'demo.alternative@uyeonhan.kr')
 where id = (select a.user_id from applications a
              join passes ps on ps.id = a.pass_id
              where a.match_status = 'ALTERNATIVE_OFFERED' and ps.type = 'SINGLE'
                and not exists (select 1 from profiles p where p.id = a.user_id and p.auth_user_id is not null)
              order by a.created_at limit 1);

-- 확인
select u.email, p.name, a.match_status, a.payment_status
  from auth.users u
  left join profiles p on p.auth_user_id = u.id
  left join applications a on a.user_id = p.id
 where u.email like 'demo.%@uyeonhan.kr'
 order by u.email;
