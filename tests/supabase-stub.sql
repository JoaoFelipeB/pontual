-- Minimal stand-in for what Supabase provides, so the migrations can be
-- tested on PGlite: roles, auth schema, auth.users and auth.uid().
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}',
  encrypted_password text,
  updated_at timestamptz,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
