-- =====================================================================
-- 0011: 같은 테이블 사람을 기억하기 쉽게 (피드백·단체방용)
--   이름은 계속 첫 글자만, 대신 대표 동물(성향 카드)·연령대·MBTI·관심사를 함께 돌려준다
-- 다시 실행해도 안전
-- =====================================================================
drop function if exists table_roster(uuid);
create function table_roster(p_table_id uuid)
returns table(profile_id uuid, nickname text, is_me boolean, age_band text, mbti text, interests text[], animals text[])
language sql stable security definer set search_path = public as $$
  select p.id, left(p.name, 1) || '○○', p.id = current_profile_id(),
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests, p.self_traits
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id and (is_table_member(p_table_id) or is_admin());
$$;
revoke all on function table_roster(uuid) from public, anon;
grant execute on function table_roster(uuid) to authenticated;
