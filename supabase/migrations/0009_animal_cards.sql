-- =====================================================================
-- 0009: 동물 카드 (나와 닮은 동물 / 함께하고 싶은 동물)
--   저장은 기존 self_traits / desired_traits 컬럼 그대로 (카드 값 = 기존 성향 문장, 1:1 대응)
--   → 시드 데이터·매칭 엔진 호환. 테이블 소개에 동물 카드를 함께 보여준다.
-- 다시 실행해도 안전
-- =====================================================================
drop function if exists table_intro(uuid);
create function table_intro(p_table_id uuid)
returns table(nickname text, age_band text, mbti text, interests text[], is_me boolean, animals text[])
language sql stable security definer set search_path = public as $$
  select left(p.name, 1) || '○○',
         ((extract(year from now())::int - p.birth_year) / 10 * 10)::text || '대',
         p.mbti, p.interests, p.id = current_profile_id(), p.self_traits
    from table_members m join profiles p on p.id = m.user_id
   where m.table_id = p_table_id
     and exists (select 1 from dining_tables t where t.id = p_table_id and t.status = 'CONFIRMED')
     and (is_table_member(p_table_id) or is_admin())
   order by (p.id = current_profile_id()) desc;
$$;
revoke all on function table_intro(uuid) from public, anon;
grant execute on function table_intro(uuid) to authenticated;
