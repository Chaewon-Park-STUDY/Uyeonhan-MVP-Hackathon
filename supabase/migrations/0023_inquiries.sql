-- =====================================================================
-- 0023: 상담 챗봇 → 운영팀 문의 (사진·PDF 첨부)
--   inquiries: 참가자 본인만 쓰고 볼 수 있음, 운영자는 전체 조회·처리
--   storage 버킷 inquiry-files (비공개): 본인 폴더(auth uid)에만 업로드, 본인·운영자만 열람
-- 다시 실행해도 안전
-- =====================================================================
create table if not exists inquiries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default current_profile_id() references profiles(id) on delete cascade,
  body        text not null check (length(body) between 1 and 2000),
  file_path   text,
  file_name   text,
  status      text not null default 'OPEN' check (status in ('OPEN', 'DONE')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
alter table inquiries enable row level security;
drop policy if exists inq_ins on inquiries;
create policy inq_ins on inquiries for insert with check (user_id = current_profile_id() and status = 'OPEN');
drop policy if exists inq_sel on inquiries;
create policy inq_sel on inquiries for select using (user_id = current_profile_id() or is_admin());
drop policy if exists inq_upd on inquiries;
create policy inq_upd on inquiries for update using (is_admin()) with check (is_admin());

-- 파일 보관함 (Supabase Storage)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inquiry-files', 'inquiry-files', false, 5242880, array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inq_file_ins on storage.objects;
create policy inq_file_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'inquiry-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists inq_file_sel on storage.objects;
create policy inq_file_sel on storage.objects for select to authenticated
  using (bucket_id = 'inquiry-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
alter table inquiries alter column user_id set default current_profile_id();
