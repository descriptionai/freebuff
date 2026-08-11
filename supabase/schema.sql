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
