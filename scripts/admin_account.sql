-- =====================================================================
-- 운영자 테스트 계정 (Supabase SQL Editor에서 실행)
-- 먼저 Authentication → Users → Add user 로 admin@uyeonhan.kr 생성 (Auto Confirm 체크)
-- 그다음 이 파일을 실행하면 운영자 프로필이 만들어진다. 여러 번 실행해도 안전.
-- =====================================================================
insert into profiles(auth_user_id, name, birth_year, gender, role, privacy_agreed_at)
select id, '운영자', 1990, 'F', 'admin', now() from auth.users where email = 'admin@uyeonhan.kr'
on conflict (auth_user_id) do update set role = 'admin';

select u.email, p.name, p.role from auth.users u join profiles p on p.auth_user_id = u.id where u.email = 'admin@uyeonhan.kr';
