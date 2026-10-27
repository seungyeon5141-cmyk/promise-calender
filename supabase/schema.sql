-- Supabase SQL Editor 에 붙여넣고 실행하세요.
create table if not exists rooms (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists marks (
  room_id text not null references rooms(id) on delete cascade,
  member text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_id, member)
);

-- 방 링크(추측하기 어려운 랜덤 ID)를 아는 사람만 접근하는 구조입니다.
alter table rooms enable row level security;
alter table marks enable row level security;

create policy "rooms read"   on rooms for select using (true);
create policy "rooms insert" on rooms for insert with check (true);
create policy "rooms update" on rooms for update using (true);
create policy "marks read"   on marks for select using (true);
create policy "marks insert" on marks for insert with check (true);
create policy "marks update" on marks for update using (true);
