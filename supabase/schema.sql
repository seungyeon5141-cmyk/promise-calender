-- Supabase SQL Editor 에 붙여넣고 실행하세요.
-- 로그인 없이 "참여코드 + 비밀번호"로 들어오는 구조입니다.
-- 테이블은 직접 접근할 수 없고, 비밀번호를 확인하는 함수(RPC)로만 읽고 쓸 수 있어요.

create extension if not exists pgcrypto with schema extensions;

create table if not exists promises (
  code text primary key,
  pw_hash text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists members (
  code text not null references promises(code) on delete cascade,
  name text not null,
  data jsonb not null default '{}',
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (code, name)
);

-- 정책을 만들지 않으므로 anon 키로는 테이블에 직접 접근 불가
alter table promises enable row level security;
alter table members enable row level security;

create or replace function _check_pw(p_code text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from promises where code = p_code and pw_hash = crypt(p_password, pw_hash)) then
    raise exception 'WRONG_CODE_OR_PASSWORD';
  end if;
end $$;
revoke execute on function _check_pw(text, text) from public, anon, authenticated;

create or replace function create_promise(p_code text, p_password text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_code) < 2 or length(p_password) < 4 then
    raise exception 'INVALID_INPUT';
  end if;
  insert into promises (code, pw_hash, data) values (p_code, crypt(p_password, gen_salt('bf')), p_data);
exception when unique_violation then
  raise exception 'CODE_TAKEN';
end $$;

create or replace function open_promise(p_code text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  return jsonb_build_object(
    'data', (select data from promises where code = p_code),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'data', data) order by joined_at)
      from members where code = p_code
    ), '[]'::jsonb)
  );
end $$;

create or replace function join_promise(p_code text, p_password text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  insert into members (code, name) values (p_code, p_name) on conflict do nothing;
end $$;

create or replace function save_member(p_code text, p_password text, p_name text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  update members set data = p_data, updated_at = now() where code = p_code and name = p_name;
end $$;

create or replace function save_promise_data(p_code text, p_password text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  update promises set data = p_data, updated_at = now() where code = p_code;
end $$;

create or replace function leave_promise(p_code text, p_password text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  delete from members where code = p_code and name = p_name;
end $$;

create or replace function delete_promise(p_code text, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _check_pw(p_code, p_password);
  delete from promises where code = p_code;
end $$;
