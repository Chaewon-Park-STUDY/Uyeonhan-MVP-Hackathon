-- =====================================================================
-- 0008: 단체방 내 메시지 삭제 (카카오톡처럼 "삭제된 메시지예요"로 표시)
--   내용은 지우고 기록(누가 언제 보냈는지)은 남긴다 → 신고 대응 시 운영자 확인 가능하도록
--   삭제 전 원문은 audit_log 에 보관 (운영자만 열람)
-- 다시 실행해도 안전
-- =====================================================================
alter table chat_messages add column if not exists deleted_at timestamptz;

create or replace function delete_my_message(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare m chat_messages%rowtype;
begin
  select * into m from chat_messages where id = p_id;
  if m.id is null or m.sender_id is distinct from current_profile_id() then raise exception 'NOT_FOUND'; end if;
  if m.deleted_at is not null then return; end if;
  insert into audit_log(entity, entity_id, field, old_value, new_value, actor, reason)
  values ('chat_messages', m.room_id, 'content#' || m.id, m.content, null, 'user:' || m.sender_id, 'deleted by sender');
  update chat_messages set content = '', deleted_at = now() where id = p_id;
end $$;

revoke all on function delete_my_message(bigint) from public, anon;
grant execute on function delete_my_message(bigint) to authenticated;
