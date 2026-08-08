-- ============================================================
-- 방명록(guestbook) 스키마
-- Supabase 대시보드 → SQL Editor 에서 이 파일 전체를 실행하세요.
-- ============================================================

-- 1) 방명록 메시지 테이블
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  author_name text not null,                                      -- 작성자 표시 이름 (이메일 앞부분)
  content     text not null check (char_length(content) between 1 and 1000),
  created_at  timestamptz not null default now()
);

-- created_at 으로 정렬 조회가 잦으므로 인덱스 추가
create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

-- 2) Row Level Security 켜기 (중요!)
alter table public.messages enable row level security;

-- 3) RLS 정책
--   - 목록 읽기 : 누구나 (익명 포함)
--   - 글 작성  : 로그인한 사용자만, 자기 user_id 로만
--   - 수정/삭제: 작성자 본인만

create policy "messages_select_all"
  on public.messages
  for select
  using (true);

create policy "messages_insert_authenticated"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "messages_update_own"
  on public.messages
  for update
  to authenticated
  using (auth.uid() = user_id);

create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4) (선택) 실시간 업데이트 - 새 글/삭제가 열려있는 다른 브라우저에 즉시 반영
alter publication supabase_realtime add table public.messages;
