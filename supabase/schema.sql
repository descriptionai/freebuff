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
-- ※ drop policy if exists: 파일을 여러 번 실행해도 에러 없이 덮어쓰도록 (멱등)

drop policy if exists "messages_select_all" on public.messages;
create policy "messages_select_all"
  on public.messages
  for select
  using (true);

drop policy if exists "messages_insert_authenticated" on public.messages;
create policy "messages_insert_authenticated"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "messages_update_own" on public.messages;
create policy "messages_update_own"
  on public.messages
  for update
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- 4) (선택) 실시간 업데이트 - 새 글/삭제가 열려있는 다른 브라우저에 즉시 반영
--    이미 추가돼 있으면 건너뛰도록 DO 블록 사용 (PG 버전 무관하게 동작)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;


-- ============================================================
-- 비용산정기준(cost_standards) 스키마
-- 노선 비용 산정 기준 목록 (standard.html 에서 편집/저장)
-- ============================================================

create table if not exists public.cost_standards (
  id           uuid primary key default gen_random_uuid(),
  sort_order   integer not null default 0,     -- 목록 순서 (1,2,3…)
  vehicle_type text not null default '전용',   -- 전용 / 아웃소싱 / 재위탁
  tonnage      text not null default '2.5톤',  -- 2.5톤 … 25톤
  distance     numeric,                        -- 거리(km)
  cost         numeric,                        -- 비용(원)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- sort_order 순으로 정렬 조회가 잦으므로 인덱스 추가
create index if not exists cost_standards_sort_idx
  on public.cost_standards (sort_order);

alter table public.cost_standards enable row level security;

-- 내부 도구로 사용하므로 읽기/쓰기를 모두 허용 (익명 포함).
-- ※ 로그인한 사용자만 쓰기 가능하게 하려면 아래 정책을
--    insert/update/delete 마다 "to authenticated" 로 나누면 됩니다.
drop policy if exists "cost_standards_all" on public.cost_standards;
create policy "cost_standards_all"
  on public.cost_standards
  for all
  using (true)
  with check (true);


-- ============================================================
-- 기존물량등록(loaded_daily) 스키마
-- 날짜별 · 우체국별 차량 적재 물량 (파렛/공파렛) — loaded.html 에서 편집/저장
-- ============================================================

create table if not exists public.loaded_daily (
  id           uuid primary key default gen_random_uuid(),
  sort_order   integer not null default 0,     -- 목록 순서 (1,2,3…)
  office_name  text not null default '',       -- 우체국/취급국명
  loaded_date  date not null default current_date, -- 적재 날짜 (YYYY-MM-DD)
  pallet       integer not null default 0,     -- 파렛 수
  empty_pallet integer not null default 0,     -- 공파렛 수
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists loaded_daily_sort_idx
  on public.loaded_daily (sort_order);

alter table public.loaded_daily enable row level security;

drop policy if exists "loaded_daily_all" on public.loaded_daily;
create policy "loaded_daily_all"
  on public.loaded_daily
  for all
  using (true)
  with check (true);


-- ============================================================
-- 우체국 목록(post_offices) 스키마
-- loaded.html 의 "우체국 리스트 최신 업로드" 버튼으로
-- js/node-navigation-data.js 의 우체국명을 DB 에 동기화
-- ============================================================

create table if not exists public.post_offices (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,             -- 우체국/취급국명
  sort_order integer not null default 0,       -- 표시 순서
  created_at timestamptz not null default now()
);

create index if not exists post_offices_sort_idx
  on public.post_offices (sort_order);

alter table public.post_offices enable row level security;

drop policy if exists "post_offices_all" on public.post_offices;
create policy "post_offices_all"
  on public.post_offices
  for all
  using (true)
  with check (true);


-- ============================================================
-- 질의/응답 채팅(chats) 스키마
-- 카카오톡 스타일 대화창 (chat.html) — 대화명 + 내용 저장, 실시간 반영
-- ============================================================

create table if not exists public.chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null default '',                         -- 브라우저 고유 ID (내 글/남의 글 구분)
  name       text not null,                                    -- 대화명 (표시용)
  content    text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- 이미 만든 테이블이면 user_id 컬럼만 추가 (멱등)
alter table public.chats add column if not exists user_id text not null default '';

-- 시간순 정렬 조회가 잦으므로 인덱스 추가
create index if not exists chats_created_at_idx
  on public.chats (created_at asc);

alter table public.chats enable row level security;

-- 내부 도구로 사용하므로 읽기/쓰기를 모두 허용 (익명 포함).
drop policy if exists "chats_all" on public.chats;
create policy "chats_all"
  on public.chats
  for all
  using (true)
  with check (true);

-- 실시간 구독: 새 메시지가 열려있는 다른 브라우저(채팅창)에 즉시 반영
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'chats'
     ) then
    alter publication supabase_realtime add table public.chats;
  end if;
end
$$;


-- ============================================================
-- 다운/로드(file_posts · file_items) 스키마
-- 제목 + 첨부파일 목록 저장 (files.html) — 파일 본문은 Supabase Storage
-- (공개 버킷 file-attachments) 에 저장하고, 메타데이터만 DB 에 보관
-- ============================================================

create table if not exists public.file_posts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 200),
  file_count integer not null default 0,          -- 첨부파일 개수 (표시용)
  created_at timestamptz not null default now()
);

create table if not exists public.file_items (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.file_posts (id) on delete cascade,
  file_name    text not null,                     -- 원본 파일명 (표시/다운로드명)
  storage_path text not null,                     -- Storage 내 경로 (bucket: file-attachments)
  size         bigint not null default 0,         -- 파일 크기(byte)
  created_at   timestamptz not null default now()
);

create index if not exists file_posts_created_idx
  on public.file_posts (created_at desc);
create index if not exists file_items_post_idx
  on public.file_items (post_id);

alter table public.file_posts enable row level security;
alter table public.file_items enable row level security;

-- 내부 도구로 사용하므로 읽기/쓰기를 모두 허용 (익명 포함).
drop policy if exists "file_posts_all" on public.file_posts;
create policy "file_posts_all"
  on public.file_posts
  for all
  using (true)
  with check (true);

drop policy if exists "file_items_all" on public.file_items;
create policy "file_items_all"
  on public.file_items
  for all
  using (true)
  with check (true);

-- 첨부파일 저장용 Storage 버킷 (공개 읽기 → URL만으로 다운로드 가능)
insert into storage.buckets (id, name, public)
values ('file-attachments', 'file-attachments', true)
on conflict (id) do update set public = true;

-- 버킷 안 파일 업로드/삭제 허용 (익명 포함 — 내부 도구)
drop policy if exists "file_attachments_all" on storage.objects;
create policy "file_attachments_all"
  on storage.objects
  for all
  using (bucket_id = 'file-attachments')
  with check (bucket_id = 'file-attachments');

-- 실시간 구독: 새 항목이 열려있는 다른 브라우저(다운/로드 창)에 즉시 반영
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'file_posts'
     ) then
    alter publication supabase_realtime add table public.file_posts;
  end if;
end
$$;
