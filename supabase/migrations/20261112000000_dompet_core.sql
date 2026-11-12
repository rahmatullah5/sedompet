-- Sedompet phase 1: shared "Dompet" (household / group) core.
--
-- A Dompet is a shared space. Users join it with a role. All finance data
-- (accounts, transactions, budgets...) will be scoped by dompet_id in phase 2.
--
-- Rules of thumb used here:
--   * Membership checks go through SECURITY DEFINER helpers to avoid RLS
--     recursion on dompet_members.
--   * Multi-row / privileged writes (create dompet, invites, role changes)
--     only happen through RPC functions. Direct INSERT/DELETE on the
--     membership tables is not granted to clients.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.dompet_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.dompets (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  currency    text not null default 'IDR' check (char_length(currency) between 1 and 10),
  icon        text,
  colour      text,
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- `id` is a surrogate key because PowerSync requires an `id` column on every
-- synced table. (dompet_id, user_id) is the real identity.
create table if not exists public.dompet_members (
  id            uuid primary key default gen_random_uuid(),
  dompet_id     uuid not null references public.dompets (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.dompet_role not null default 'member',
  display_name  text check (display_name is null or char_length(display_name) between 1 and 60),
  colour        text,
  joined_at     timestamptz not null default now(),
  unique (dompet_id, user_id)
);
create index if not exists dompet_members_user_idx on public.dompet_members (user_id);

create table if not exists public.dompet_invites (
  code        text primary key,
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  role        public.dompet_role not null default 'member' check (role <> 'owner'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  max_uses    int not null default 10 check (max_uses between 1 and 100),
  uses        int not null default 0,
  revoked     boolean not null default false
);
create index if not exists dompet_invites_dompet_idx on public.dompet_invites (dompet_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.dompet_role_of(p_dompet_id uuid, p_user_id uuid default auth.uid())
returns public.dompet_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.dompet_members m
  where m.dompet_id = p_dompet_id and m.user_id = p_user_id
$$;

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
  )
$$;

-- Roles allowed to write finance data (used by phase 2 policies too).
create or replace function public.can_write_dompet(p_dompet_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_dompet_member(p_dompet_id, array['owner','admin','member']::public.dompet_role[])
$$;

create or replace function public.can_admin_dompet(p_dompet_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_dompet_member(p_dompet_id, array['owner','admin']::public.dompet_role[])
$$;

create or replace function public.default_display_name(p_user_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select left(coalesce(
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    split_part(u.email, '@', 1),
    'Member'
  ), 60)
  from auth.users u where u.id = p_user_id
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists dompets_touch on public.dompets;
create trigger dompets_touch before update on public.dompets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create a Dompet and make the caller its owner, atomically.
create or replace function public.create_dompet(
  p_name text,
  p_currency text default 'IDR',
  p_icon text default null,
  p_colour text default null
)
returns public.dompets
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_dompet public.dompets;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.dompets (name, currency, icon, colour, created_by)
  values (trim(p_name), coalesce(nullif(trim(p_currency), ''), 'IDR'), p_icon, p_colour, v_uid)
  returning * into v_dompet;

  insert into public.dompet_members (dompet_id, user_id, role, display_name)
  values (v_dompet.id, v_uid, 'owner', public.default_display_name(v_uid));

  return v_dompet;
end $$;

-- Create an invite code. Owners/admins only; only owners may invite admins.
create or replace function public.create_dompet_invite(
  p_dompet_id uuid,
  p_role public.dompet_role default 'member',
  p_max_uses int default 10,
  p_valid_days int default 7
)
returns public.dompet_invites
language plpgsql security definer set search_path = ''
as $$
declare
  -- No 0/O/1/I/L to keep codes easy to read aloud.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_caller_role public.dompet_role := public.dompet_role_of(p_dompet_id);
  v_code text;
  v_bytes bytea;
  v_invite public.dompet_invites;
  i int;
begin
  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'cannot_invite_owner' using errcode = '22023';
  end if;
  if p_role = 'admin' and v_caller_role <> 'owner' then
    raise exception 'only_owner_can_invite_admin' using errcode = '42501';
  end if;

  loop
    -- gen_random_uuid() is backed by a CSPRNG; bytes 0..5 of a v4 uuid are
    -- fully random. (Avoids depending on pgcrypto's schema location.)
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into public.dompet_invites (code, dompet_id, role, created_by, expires_at, max_uses)
      values (
        v_code, p_dompet_id, p_role, auth.uid(),
        now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 7), 30))),
        greatest(1, least(coalesce(p_max_uses, 10), 100))
      )
      returning * into v_invite;
      return v_invite;
    exception when unique_violation then
      -- collision, try another code
    end;
  end loop;
end $$;

-- Join a Dompet using an invite code. Returns the dompet id.
-- Joining a Dompet you're already in is a no-op (does not consume a use).
create or replace function public.redeem_dompet_invite(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.dompet_invites;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_invite from public.dompet_invites
  where code = upper(replace(trim(p_code), ' ', ''))
  for update;

  if not found or v_invite.revoked or v_invite.expires_at < now()
     or v_invite.uses >= v_invite.max_uses then
    raise exception 'invalid_invite' using errcode = '22023';
  end if;

  insert into public.dompet_members (dompet_id, user_id, role, display_name)
  values (v_invite.dompet_id, v_uid, v_invite.role, public.default_display_name(v_uid))
  on conflict (dompet_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    update public.dompet_invites set uses = uses + 1 where code = v_invite.code;
  end if;

  return v_invite.dompet_id;
end $$;

-- Change a member's role.
--   owner: may set any role on anyone, but a Dompet must keep >= 1 owner.
--   admin: may only move members/viewers between member and viewer.
create or replace function public.set_dompet_member_role(
  p_dompet_id uuid,
  p_user_id uuid,
  p_role public.dompet_role
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_caller_role public.dompet_role := public.dompet_role_of(p_dompet_id);
  v_target_role public.dompet_role := public.dompet_role_of(p_dompet_id, p_user_id);
begin
  if v_target_role is null then
    raise exception 'not_a_member' using errcode = '22023';
  end if;

  if v_caller_role = 'owner' then
    null;
  elsif v_caller_role = 'admin'
        and v_target_role in ('member', 'viewer')
        and p_role in ('member', 'viewer') then
    null;
  else
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock owner rows so concurrent demotions can't leave zero owners.
  perform 1 from public.dompet_members
  where dompet_id = p_dompet_id and role = 'owner' for update;

  if v_target_role = 'owner' and p_role <> 'owner' and (
    select count(*) from public.dompet_members
    where dompet_id = p_dompet_id and role = 'owner'
  ) <= 1 then
    raise exception 'last_owner' using errcode = '22023';
  end if;

  update public.dompet_members set role = p_role
  where dompet_id = p_dompet_id and user_id = p_user_id;
end $$;

-- Remove another member.
--   owner: anyone except themself (use leave_dompet).
--   admin: members and viewers only.
create or replace function public.remove_dompet_member(p_dompet_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_caller_role public.dompet_role := public.dompet_role_of(p_dompet_id);
  v_target_role public.dompet_role := public.dompet_role_of(p_dompet_id, p_user_id);
begin
  if p_user_id = auth.uid() then
    raise exception 'use_leave_dompet' using errcode = '22023';
  end if;
  if v_target_role is null then
    return;
  end if;
  if not (
    v_caller_role = 'owner'
    or (v_caller_role = 'admin' and v_target_role in ('member', 'viewer'))
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.dompet_members where dompet_id = p_dompet_id and user_id = p_user_id;
end $$;

-- Leave a Dompet. The last member leaving deletes the Dompet (and, in phase 2,
-- all of its data via ON DELETE CASCADE). The last owner cannot leave while
-- other members remain; they must promote someone first.
create or replace function public.leave_dompet(p_dompet_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.dompet_role := public.dompet_role_of(p_dompet_id);
  v_member_count int;
  v_owner_count int;
begin
  if v_role is null then
    return;
  end if;

  -- Lock the whole membership of this dompet to serialise leave/role changes.
  perform 1 from public.dompet_members where dompet_id = p_dompet_id for update;

  select count(*), count(*) filter (where role = 'owner')
  into v_member_count, v_owner_count
  from public.dompet_members where dompet_id = p_dompet_id;

  if v_member_count <= 1 then
    delete from public.dompets where id = p_dompet_id;
    return;
  end if;

  if v_role = 'owner' and v_owner_count <= 1 then
    raise exception 'last_owner' using errcode = '22023';
  end if;

  delete from public.dompet_members where dompet_id = p_dompet_id and user_id = v_uid;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.dompets        enable row level security;
alter table public.dompet_members enable row level security;
alter table public.dompet_invites enable row level security;

-- dompets: members read; owners/admins rename etc.; owners delete.
-- No INSERT policy: creation goes through create_dompet().
drop policy if exists dompets_select on public.dompets;
create policy dompets_select on public.dompets
  for select to authenticated using (public.is_dompet_member(id));

drop policy if exists dompets_update on public.dompets;
create policy dompets_update on public.dompets
  for update to authenticated
  using (public.can_admin_dompet(id))
  with check (public.can_admin_dompet(id));

drop policy if exists dompets_delete on public.dompets;
create policy dompets_delete on public.dompets
  for delete to authenticated
  using (public.is_dompet_member(id, array['owner']::public.dompet_role[]));

-- dompet_members: members see each other; each user may edit their own
-- display_name/colour (column grants below stop them editing role).
drop policy if exists dompet_members_select on public.dompet_members;
create policy dompet_members_select on public.dompet_members
  for select to authenticated using (public.is_dompet_member(dompet_id));

drop policy if exists dompet_members_update_self on public.dompet_members;
create policy dompet_members_update_self on public.dompet_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- dompet_invites: only owners/admins see and revoke invites.
drop policy if exists dompet_invites_select on public.dompet_invites;
create policy dompet_invites_select on public.dompet_invites
  for select to authenticated using (public.can_admin_dompet(dompet_id));

drop policy if exists dompet_invites_update on public.dompet_invites;
create policy dompet_invites_update on public.dompet_invites
  for update to authenticated
  using (public.can_admin_dompet(dompet_id))
  with check (public.can_admin_dompet(dompet_id));

-- ---------------------------------------------------------------------------
-- Grants (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------
revoke all on public.dompets, public.dompet_members, public.dompet_invites from anon;
revoke insert, update, delete on public.dompets, public.dompet_members, public.dompet_invites from authenticated;

grant select on public.dompets, public.dompet_members, public.dompet_invites to authenticated;
grant update (name, currency, icon, colour) on public.dompets to authenticated;
grant delete on public.dompets to authenticated;
grant update (display_name, colour) on public.dompet_members to authenticated;
grant update (revoked) on public.dompet_invites to authenticated;

revoke execute on function
  public.dompet_role_of(uuid, uuid),
  public.default_display_name(uuid),
  public.create_dompet(text, text, text, text),
  public.create_dompet_invite(uuid, public.dompet_role, int, int),
  public.redeem_dompet_invite(text),
  public.set_dompet_member_role(uuid, uuid, public.dompet_role),
  public.remove_dompet_member(uuid, uuid),
  public.leave_dompet(uuid)
from public, anon;

-- Internal helpers: callable only from the SECURITY DEFINER functions above.
-- default_display_name would otherwise leak any user's email prefix.
revoke execute on function
  public.dompet_role_of(uuid, uuid),
  public.default_display_name(uuid)
from authenticated;

grant execute on function
  public.create_dompet(text, text, text, text),
  public.create_dompet_invite(uuid, public.dompet_role, int, int),
  public.redeem_dompet_invite(text),
  public.set_dompet_member_role(uuid, uuid, public.dompet_role),
  public.remove_dompet_member(uuid, uuid),
  public.leave_dompet(uuid),
  public.is_dompet_member(uuid, public.dompet_role[]),
  public.can_write_dompet(uuid),
  public.can_admin_dompet(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- PowerSync replication
-- ---------------------------------------------------------------------------
-- PowerSync reads changes through this publication. Phase 2 adds the finance
-- tables (accounts, transactions, ...) to it.
do $$ begin
  create publication powersync for table public.dompets, public.dompet_members;
exception when duplicate_object then null; end $$;
