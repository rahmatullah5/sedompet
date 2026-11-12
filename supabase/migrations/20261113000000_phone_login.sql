-- Sedompet: phone number + PIN login, activated by an admin. No SMS needed.
--
-- How it works
--   * Supabase Auth only knows emails, so a phone is mapped to a synthetic
--     address: 6281234567890@phone.sedompet.app (never receives mail).
--   * An admin activates a number in public.phone_access (SQL editor).
--   * The "Before User Created" auth hook rejects sign-ups for numbers that
--     are not activated, so nobody can claim a number before you allow it.
--   * dompet_members can hold a placeholder row for a phone (user_id NULL).
--     After login the app calls claim_phone_membership(), which links the
--     placeholder to the new account. That's how initial data and family
--     members are pre-assigned without invites.
--
-- Supabase dashboard settings this relies on (see SETUP.md):
--   Authentication > Sign In / Providers > Email: "Confirm email" OFF
--   Authentication > Hooks > Before User Created > public.hook_before_user_created

-- ---------------------------------------------------------------------------
-- Phone helpers
-- ---------------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when d like '62%' then d
    when d like '0%'  then '62' || substr(d, 2)
    when d like '8%'  then '62' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

-- Phone part of a synthetic login email, or NULL for other emails.
create or replace function public.phone_from_email(p_email text)
returns text
language sql immutable set search_path = ''
as $$
  select case when lower(p_email) ~ '^62[0-9]{8,13}@phone\.sedompet\.app$'
              then split_part(lower(p_email), '@', 1) end
$$;

-- ---------------------------------------------------------------------------
-- Activation list (admin-managed)
-- ---------------------------------------------------------------------------
create table if not exists public.phone_access (
  phone         text primary key check (phone ~ '^62[0-9]{8,13}$'),
  activated     boolean not null default false,
  note          text,
  user_id       uuid unique references auth.users (id) on delete set null,
  activated_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.phone_access enable row level security;
revoke all on public.phone_access from anon, authenticated;
-- Users may read their own row (to see "not activated yet").
grant select on public.phone_access to authenticated;
drop policy if exists phone_access_self on public.phone_access;
create policy phone_access_self on public.phone_access for select to authenticated
  using (phone = public.phone_from_email(auth.jwt() ->> 'email'));

create or replace function public.phone_is_activated(p_phone text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.phone_access a where a.phone = p_phone and a.activated)
$$;

-- Has this auth user been activated? (phone users only; others are never activated)
create or replace function public.user_is_activated(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.phone_is_activated(public.phone_from_email(u.email))
  from auth.users u where u.id = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- Placeholder members: a phone can be in a Dompet before it has an account.
-- ---------------------------------------------------------------------------
alter table public.dompet_members alter column user_id drop not null;
alter table public.dompet_members add column if not exists phone text check (phone is null or phone ~ '^62[0-9]{8,13}$');
do $$ begin
  alter table public.dompet_members add constraint dompet_members_user_or_phone check (user_id is not null or phone is not null);
exception when duplicate_object then null; end $$;
create unique index if not exists dompet_members_phone_uq on public.dompet_members (dompet_id, phone) where phone is not null;

-- Only activated accounts can become members (covers create_dompet,
-- redeem_dompet_invite and claim_phone_membership).
create or replace function public.require_activated_member()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and not public.user_is_activated(new.user_id) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists dompet_members_activated on public.dompet_members;
create trigger dompet_members_activated before insert or update of user_id on public.dompet_members
  for each row execute function public.require_activated_member();

-- ---------------------------------------------------------------------------
-- Called by the app right after login.
-- ---------------------------------------------------------------------------
create or replace function public.claim_phone_membership()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_owner uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select public.phone_from_email(email) into v_phone from auth.users where id = v_uid;
  if v_phone is null or not public.phone_is_activated(v_phone) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  select user_id into v_owner from public.phone_access where phone = v_phone for update;
  if v_owner is not null and v_owner <> v_uid then
    raise exception 'phone_already_claimed' using errcode = '42501';
  end if;
  update public.phone_access set user_id = v_uid where phone = v_phone and user_id is null;

  update public.dompet_members m set user_id = v_uid
  where m.phone = v_phone and m.user_id is null
    and not exists (select 1 from public.dompet_members x where x.dompet_id = m.dompet_id and x.user_id = v_uid);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.claim_phone_membership() from public, anon;
grant execute on function public.claim_phone_membership() to authenticated;
revoke execute on function public.phone_is_activated(text), public.user_is_activated(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Auth hook: block sign-ups for numbers that are not activated.
-- Configure in Dashboard > Authentication > Hooks > Before User Created.
-- ---------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := coalesce(event -> 'user' ->> 'email', event ->> 'email');
  v_phone text := public.phone_from_email(v_email);
begin
  if v_phone is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Daftar hanya bisa dengan nomor HP yang sudah diaktifkan.'));
  end if;
  if not public.phone_is_activated(v_phone) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Nomor ini belum diaktifkan. Hubungi admin Sedompet.'));
  end if;
  if exists (select 1 from public.phone_access where phone = v_phone and user_id is not null) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 409, 'message', 'Nomor ini sudah terdaftar. Silakan masuk.'));
  end if;
  return '{}'::jsonb;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin helper (SQL editor only):
--   select admin_activate_phone('0812xxxx');                         -- just allow login
--   select admin_activate_phone('0812xxxx', '<dompet uuid>', 'member', 'Ibu');  -- and add to a Dompet
-- ---------------------------------------------------------------------------
create or replace function public.admin_activate_phone(
  p_phone text,
  p_dompet_id uuid default null,
  p_role public.dompet_role default 'member',
  p_display_name text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_phone text := public.normalize_phone(p_phone);
begin
  insert into public.phone_access (phone, activated, activated_at)
  values (v_phone, true, now())
  on conflict (phone) do update set activated = true, activated_at = now();

  if p_dompet_id is not null then
    insert into public.dompet_members (dompet_id, phone, role, display_name, user_id)
    values (p_dompet_id, v_phone, p_role, p_display_name,
            (select user_id from public.phone_access where phone = v_phone))
    on conflict do nothing;
  end if;
  return v_phone;
end $$;
revoke execute on function public.admin_activate_phone(text, uuid, public.dompet_role, text) from public, anon, authenticated;

create or replace function public.admin_deactivate_phone(p_phone text)
returns void
language sql security definer set search_path = ''
as $$
  update public.phone_access set activated = false where phone = public.normalize_phone(p_phone)
$$;
revoke execute on function public.admin_deactivate_phone(text) from public, anon, authenticated;

-- Deactivated users lose access to every Dompet straight away.
create or replace function public.is_dompet_member(
  p_dompet_id uuid,
  p_roles public.dompet_role[] default array['owner','admin','member','viewer']::public.dompet_role[]
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.dompet_members m
    where m.dompet_id = p_dompet_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  ) and coalesce(public.user_is_activated(auth.uid()), false)
$$;
