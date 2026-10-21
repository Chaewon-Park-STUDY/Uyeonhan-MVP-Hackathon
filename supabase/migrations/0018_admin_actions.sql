-- =====================================================================
-- 0018: 처리대기함에서 운영자가 바로 해결할 수 있는 버튼들
--   식당 배정 실패  → 식당 직접 지정 (단체방에 안내 자동 게시)
--   취소로 4명 미만 → 3명으로 그대로 진행 / 테이블 다시 짜기(남은 사람에게 다른 일정·환불 선택 제공)
--   안내 발송 실패  → 다시 보내기
--   식당 수용: 회차(날짜)별로 따로 조정
-- 다시 실행해도 안전
-- =====================================================================

-- 식당 직접 지정
create or replace function admin_assign_venue(p_table uuid, p_venue uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t dining_tables%rowtype; v venues%rowtype;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into t from dining_tables where id = p_table;
  select * into v from venues where id = p_venue;
  if t.id is null or v.id is null then raise exception 'NOT_FOUND'; end if;
  perform set_config('app.actor', 'admin:' || current_profile_id(), true);
  if t.venue_id is not null then
    update venue_availability set tables_used = greatest(0, tables_used - 1) where venue_id = t.venue_id and slot_id = t.slot_id;
  end if;
  insert into venue_availability(venue_id, slot_id, tables_total, tables_used) values (p_venue, t.slot_id, 1, 1)
  on conflict (venue_id, slot_id) do update
    set tables_used = venue_availability.tables_used + 1,
        tables_total = greatest(venue_availability.tables_total, venue_availability.tables_used + 1);
  update dining_tables set venue_id = p_venue where id = p_table;
  insert into chat_messages(room_id, kind, content)
  select c.id, 'NOTICE', '📍 ' || v.name || E'\n(' || v.address || E')\n예약은 "우연한 식탁" 이름으로 되어 있어요.'
    from chat_rooms c where c.table_id = p_table;
  update exception_cases set status = 'RESOLVED', resolved_at = now(), admin_note = '식당 직접 지정: ' || v.name
   where table_id = p_table and kind = 'VENUE' and status = 'OPEN';
  return v.name;
end $$;
revoke all on function admin_assign_venue(uuid, uuid) from public, anon;
grant execute on function admin_assign_venue(uuid, uuid) to authenticated;

-- 결원 테이블: 그대로 진행(KEEP) / 다시 짜기(DISSOLVE)
create or replace function admin_short_table(p_table uuid, p_mode text) returns text
language plpgsql security definer set search_path = public as $$
declare t dining_tables%rowtype; r record;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into t from dining_tables where id = p_table;
  if t.id is null then raise exception 'NOT_FOUND'; end if;
  perform set_config('app.actor', 'admin:' || current_profile_id(), true);

  if p_mode = 'KEEP' then
    insert into chat_messages(room_id, kind, content)
    select c.id, 'NOTICE', '한 분이 사정이 생겨 이번에는 조금 더 오붓하게 만나요. 일정·장소는 그대로예요.'
      from chat_rooms c where c.table_id = p_table;
    update exception_cases set status = 'RESOLVED', resolved_at = now(), admin_note = '남은 인원으로 그대로 진행'
     where table_id = p_table and kind = 'CONFLICT' and status = 'OPEN';
    return 'KEPT';
  elsif p_mode = 'DISSOLVE' then
    update dining_tables set status = 'DISSOLVED' where id = p_table;
    update venue_availability set tables_used = greatest(0, tables_used - 1) where venue_id = t.venue_id and slot_id = t.slot_id;
    for r in select m.application_id from table_members m
              where m.table_id = p_table and m.attendance = 'SCHEDULED' and m.application_id is not null loop
      update applications set match_status = 'ALTERNATIVE_OFFERED', assigned_slot_id = null where id = r.application_id;
      insert into match_resolutions(application_id, offered_slots, reason)
      values (r.application_id,
              coalesce(array(select e.id from event_slots e where e.is_open and e.apply_deadline > now() order by e.starts_at limit 3), '{}'),
              '인원 부족: 확정 후 취소가 생겨 테이블을 다시 짜게 됐어요')
      on conflict (application_id) do update set offered_slots = excluded.offered_slots, reason = excluded.reason,
                                                 choice = null, chosen_slot_id = null, resolved_at = null;
    end loop;
    insert into chat_messages(room_id, kind, content)
    select c.id, 'NOTICE', '취소가 생겨 이번 테이블은 열리지 않게 됐어요. 미안해요. 홈에서 다른 일정으로 옮기거나 전액 환불을 고를 수 있어요.'
      from chat_rooms c where c.table_id = p_table;
    update exception_cases set status = 'RESOLVED', resolved_at = now(), admin_note = '테이블 다시 짜기 → 남은 참가자에게 다른 일정·환불 제안'
     where table_id = p_table and kind = 'CONFLICT' and status = 'OPEN';
    return 'DISSOLVED';
  end if;
  raise exception 'INVALID_MODE';
end $$;
revoke all on function admin_short_table(uuid, text) from public, anon;
grant execute on function admin_short_table(uuid, text) to authenticated;

-- 안내 다시 보내기
create or replace function admin_retry_notify(p_table uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  update notifications set attempts = 0, last_error = null
   where (payload->>'table_id')::uuid = p_table and sent_at is null and last_error is not null;
  get diagnostics n = row_count;
  update exception_cases set status = 'RESOLVED', resolved_at = now(), admin_note = '다시 보내기 (' || n || '건)'
   where table_id = p_table and kind = 'NOTIFY' and status = 'OPEN';
  return n;
end $$;
revoke all on function admin_retry_notify(uuid) from public, anon;
grant execute on function admin_retry_notify(uuid) to authenticated;

-- 식당 수용: 회차별
create or replace function admin_set_slot_capacity(p_venue uuid, p_slot uuid, p_tables int) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  insert into venue_availability(venue_id, slot_id, tables_total) values (p_venue, p_slot, greatest(0, p_tables))
  on conflict (venue_id, slot_id) do update set tables_total = greatest(venue_availability.tables_used, excluded.tables_total);
  return p_tables;
end $$;
revoke all on function admin_set_slot_capacity(uuid, uuid, int) from public, anon;
grant execute on function admin_set_slot_capacity(uuid, uuid, int) to authenticated;
