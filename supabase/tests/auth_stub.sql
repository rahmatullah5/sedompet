create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;

create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', (select email from auth.users where id = auth.uid())) $$;
grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','6281100000001@phone.sedompet.app','{"full_name":"Ayah"}'),
 ('22222222-2222-2222-2222-222222222222','6281100000002@phone.sedompet.app','{}'),
 ('33333333-3333-3333-3333-333333333333','6281100000003@phone.sedompet.app','{}'),
 ('44444444-4444-4444-4444-444444444444','6281100000004@phone.sedompet.app','{}');

grant execute on function auth.jwt() to anon, authenticated;
-- Columns/tables register_phone() writes, mirroring Supabase's auth schema.
alter table auth.users add column instance_id uuid, add column aud text, add column role text,
  add column encrypted_password text, add column email_confirmed_at timestamptz,
  add column raw_app_meta_data jsonb, add column created_at timestamptz, add column updated_at timestamptz,
  add column confirmation_token text, add column recovery_token text, add column email_change_token_new text,
  add column email_change text, add column email_change_token_current text, add column reauthentication_token text,
  add column phone_change text, add column phone_change_token text, add column last_sign_in_at timestamptz;
create table auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text,
  provider text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
  unique (provider_id, provider));
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
-- Sessions (Supabase bumps updated_at/refreshed_at on token refresh).
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz, updated_at timestamptz, refreshed_at timestamp without time zone);
