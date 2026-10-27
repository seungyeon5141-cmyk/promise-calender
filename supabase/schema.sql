-- Supabase SQL Editor 에 붙여넣고 실행하세요.

create table if not exists promises (
  id text primary key,
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists participants (
  promise_id text not null references promises(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  avatar text,
  data jsonb not null default '{}',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (promise_id, user_id)
);

-- 내가 이 약속의 참여자인지 (RLS 정책 안에서 재귀 없이 쓰기 위한 함수)
create or replace function is_member(pid text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from participants where promise_id = pid and user_id = auth.uid());
$$;

alter table promises enable row level security;
alter table participants enable row level security;

-- 약속: 참여자만 보고 수정, 만든 사람만 삭제
create policy "promise read"   on promises for select to authenticated using (owner = auth.uid() or is_member(id));
create policy "promise insert" on promises for insert to authenticated with check (owner = auth.uid());
create policy "promise update" on promises for update to authenticated using (is_member(id));
create policy "promise delete" on promises for delete to authenticated using (owner = auth.uid());

-- 참여자: 초대 링크(약속 ID)를 아는 로그인 사용자는 스스로 참여 가능, 내 행만 수정
create policy "member read"   on participants for select to authenticated using (is_member(promise_id));
create policy "member join"   on participants for insert to authenticated with check (user_id = auth.uid());
create policy "member update" on participants for update to authenticated using (user_id = auth.uid());
create policy "member leave"  on participants for delete to authenticated using (user_id = auth.uid());
