-- Sedompet: run this whole file once in Supabase > SQL Editor.
-- Generated from supabase/migrations/*.sql (safe to re-run).

-- ===== supabase/migrations/20261112000000_dompet_core.sql =====
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

-- ===== supabase/migrations/20261112010000_finance.sql =====
-- Sedompet phase 2: shared finance data, scoped by dompet_id.
-- Depends on 20261112000000_dompet_core.sql.
--
-- Visibility rules (mirrored in web/src/lib/permissions.ts):
--   * Shared accounts and their transactions: every member of the Dompet.
--   * Private accounts and their transactions: only owner_member_id.
--   * owner/admin manage accounts, categories, budgets; member records
--     transactions and edits only their own; viewer reads only.

-- Members get an emoji avatar.
alter table public.dompet_members add column if not exists emoji text not null default '🙂';
grant update (emoji) on public.dompet_members to authenticated;

-- The caller's member row id in a Dompet (NULL if not a member).
create or replace function public.my_member_id(p_dompet_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id from public.dompet_members m
  where m.dompet_id = p_dompet_id and m.user_id = auth.uid()
$$;

-- True when member row p_member_id belongs to Dompet p_dompet_id.
create or replace function public.member_in_dompet(p_member_id uuid, p_dompet_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_member_id is null or exists (
    select 1 from public.dompet_members m where m.id = p_member_id and m.dompet_id = p_dompet_id
  )
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  dompet_id        uuid not null references public.dompets (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 40),
  type             text not null check (type in ('cash','bank','ewallet','savings')),
  opening_balance  bigint not null default 0,
  colour           text not null default '#f47c5a',
  -- Emoji, or a small uploaded image as a data: URL (resized client-side).
  icon             text check (icon is null or char_length(icon) <= 60000),
  visibility       text not null default 'shared' check (visibility in ('shared','private')),
  -- Private accounts disappear with their owner.
  owner_member_id  uuid references public.dompet_members (id) on delete cascade,
  archived         boolean not null default false,
  created_by       uuid references public.dompet_members (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (visibility = 'shared' or owner_member_id is not null)
);
create index if not exists accounts_dompet_idx on public.accounts (dompet_id);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  icon        text not null default '📦' check (char_length(icon) <= 60000),
  colour      text not null default '#b29d8b',
  kind        text not null check (kind in ('expense','income')),
  -- Subcategory: one level deep, same Dompet and kind (enforced by trigger).
  parent_id   uuid references public.categories (id) on delete cascade,
  sort_order  int not null default 0,
  check (parent_id is null or parent_id <> id)
);
create index if not exists categories_parent_idx on public.categories (parent_id);

create or replace function public.check_category_parent()
returns trigger language plpgsql set search_path = '' as $$
declare p public.categories;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into p from public.categories where id = new.parent_id;
  if p.id is null or p.dompet_id <> new.dompet_id then
    raise exception 'parent_not_in_dompet' using errcode = '22023';
  end if;
  if p.parent_id is not null then
    raise exception 'subcategory_too_deep' using errcode = '22023';
  end if;
  if p.kind <> new.kind then
    raise exception 'subcategory_kind_mismatch' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists categories_parent_check on public.categories;
create trigger categories_parent_check before insert or update on public.categories
  for each row execute function public.check_category_parent();
create index if not exists categories_dompet_idx on public.categories (dompet_id);

create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  dompet_id    uuid not null references public.dompets (id) on delete cascade,
  account_id   uuid not null references public.accounts (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  kind         text not null check (kind in ('expense','income')),
  amount       bigint not null check (amount > 0),
  date         date not null,
  note         text not null default '' check (char_length(note) <= 140),
  -- 'transfer' (between own accounts) and 'adjustment' (balance correction)
  -- move balances but are excluded from spending/income totals.
  -- 'loan' = money lent/borrowed or repaid (balance moves, not spending).
  flag         text check (flag in ('transfer','adjustment','loan')),
  loan_id      uuid,            -- FK added below, after loans exists
  recurring_id uuid,            -- FK added below, after recurring exists
  paid_by      uuid references public.dompet_members (id) on delete set null,
  created_by   uuid references public.dompet_members (id) on delete set null,
  updated_by   uuid references public.dompet_members (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists transactions_dompet_date_idx on public.transactions (dompet_id, date desc);
create index if not exists transactions_account_idx on public.transactions (account_id);

create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  dompet_id    uuid not null references public.dompets (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  amount       bigint not null check (amount > 0),
  category_id  uuid references public.categories (id) on delete cascade,
  member_id    uuid references public.dompet_members (id) on delete cascade,
  -- For "all spending" budgets: categories to leave out (subcategories follow).
  exclude_category_ids uuid[] not null default '{}',
  created_by   uuid references public.dompet_members (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists budgets_dompet_idx on public.budgets (dompet_id);

-- Loans: 'lent' = someone owes us (piutang), 'borrowed' = we owe (utang).
-- Principal and repayments are transactions with flag = 'loan' and loan_id.
create table if not exists public.loans (
  id            uuid primary key default gen_random_uuid(),
  dompet_id     uuid not null references public.dompets (id) on delete cascade,
  direction     text not null check (direction in ('lent','borrowed')),
  counterparty  text not null check (char_length(counterparty) between 1 and 60),
  amount        bigint not null check (amount > 0),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  start_date    date not null default current_date,
  due_date      date,
  note          text not null default '' check (char_length(note) <= 140),
  settled       boolean not null default false,
  created_by    uuid references public.dompet_members (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists loans_dompet_idx on public.loans (dompet_id);

-- Recurring templates: subscriptions/bills (expense) and salary etc (income).
-- When due, a member taps "Catat" to create the transaction and advance next_date.
create table if not exists public.recurring (
  id            uuid primary key default gen_random_uuid(),
  dompet_id     uuid not null references public.dompets (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  icon          text check (icon is null or char_length(icon) <= 60000),
  kind          text not null check (kind in ('expense','income')),
  amount        bigint not null check (amount > 0),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  category_id   uuid references public.categories (id) on delete set null,
  paid_by       uuid references public.dompet_members (id) on delete set null,
  frequency     text not null check (frequency in ('weekly','monthly','yearly')),
  every         int not null default 1 check (every between 1 and 12),
  next_date     date not null,
  end_date      date,
  active        boolean not null default true,
  created_by    uuid references public.dompet_members (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists recurring_dompet_idx on public.recurring (dompet_id, next_date);

do $$ begin
  alter table public.transactions
    add constraint transactions_loan_fk foreign key (loan_id) references public.loans (id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions
    add constraint transactions_recurring_fk foreign key (recurring_id) references public.recurring (id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.activity (
  id          uuid primary key default gen_random_uuid(),
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  member_id   uuid references public.dompet_members (id) on delete set null,
  message     text not null check (char_length(message) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index if not exists activity_dompet_idx on public.activity (dompet_id, created_at desc);

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

-- Can the caller see this account? (shared, or private and theirs)
create or replace function public.can_see_account(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account_id
      and public.is_dompet_member(a.dompet_id)
      and (a.visibility = 'shared' or a.owner_member_id = public.my_member_id(a.dompet_id))
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;
alter table public.activity     enable row level security;
alter table public.loans        enable row level security;
alter table public.recurring    enable row level security;

-- accounts
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts for select to authenticated
  using (public.is_dompet_member(dompet_id)
         and (visibility = 'shared' or owner_member_id = public.my_member_id(dompet_id)));

drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts for all to authenticated
  using (
    (visibility = 'shared' and public.can_admin_dompet(dompet_id))
    or (visibility = 'private' and owner_member_id = public.my_member_id(dompet_id))
  )
  with check (
    (visibility = 'shared' and owner_member_id is null and public.can_admin_dompet(dompet_id))
    or (visibility = 'private' and public.can_write_dompet(dompet_id)
        and owner_member_id = public.my_member_id(dompet_id))
  );

-- categories
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (public.is_dompet_member(dompet_id));
drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories for all to authenticated
  using (public.can_admin_dompet(dompet_id))
  with check (public.can_admin_dompet(dompet_id));

-- transactions
drop policy if exists transactions_select on public.transactions;
create policy transactions_select on public.transactions for select to authenticated
  using (public.can_see_account(account_id));

-- Integrity shared by insert/update: account, category and people all in the same Dompet.
create or replace function public.tx_refs_ok(
  p_dompet_id uuid, p_account_id uuid, p_category_id uuid, p_paid_by uuid
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.accounts a where a.id = p_account_id and a.dompet_id = p_dompet_id)
     and (p_category_id is null or exists (
           select 1 from public.categories c where c.id = p_category_id and c.dompet_id = p_dompet_id))
     and public.member_in_dompet(p_paid_by, p_dompet_id)
$$;

drop policy if exists transactions_insert on public.transactions;
create policy transactions_insert on public.transactions for insert to authenticated
  with check (
    public.can_write_dompet(dompet_id)
    and public.can_see_account(account_id)
    and created_by = public.my_member_id(dompet_id)
    and public.tx_refs_ok(dompet_id, account_id, category_id, paid_by)
  );

drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  )
  with check (
    public.can_see_account(account_id)
    and updated_by = public.my_member_id(dompet_id)
    and public.tx_refs_ok(dompet_id, account_id, category_id, paid_by)
  );

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  );

-- budgets
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using (public.is_dompet_member(dompet_id));
drop policy if exists budgets_write on public.budgets;
create policy budgets_write on public.budgets for all to authenticated
  using (public.can_admin_dompet(dompet_id))
  with check (public.can_admin_dompet(dompet_id) and public.member_in_dompet(member_id, dompet_id));

-- loans: visible with their account; members manage their own, admins all.
drop policy if exists loans_select on public.loans;
create policy loans_select on public.loans for select to authenticated
  using (public.can_see_account(account_id));
drop policy if exists loans_insert on public.loans;
create policy loans_insert on public.loans for insert to authenticated
  with check (public.can_write_dompet(dompet_id) and public.can_see_account(account_id)
              and created_by = public.my_member_id(dompet_id)
              and public.tx_refs_ok(dompet_id, account_id, null, null));
drop policy if exists loans_modify on public.loans;
create policy loans_modify on public.loans for update to authenticated
  using (public.can_see_account(account_id)
         and (public.can_admin_dompet(dompet_id)
              or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id))))
  with check (public.can_see_account(account_id) and public.tx_refs_ok(dompet_id, account_id, null, null));
drop policy if exists loans_delete on public.loans;
create policy loans_delete on public.loans for delete to authenticated
  using (public.can_see_account(account_id)
         and (public.can_admin_dompet(dompet_id)
              or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id))));

-- recurring: everyone sees (if account visible); admins manage; members may
-- only advance next_date (that happens when they record a due item).
drop policy if exists recurring_select on public.recurring;
create policy recurring_select on public.recurring for select to authenticated
  using (public.can_see_account(account_id));
drop policy if exists recurring_admin on public.recurring;
create policy recurring_admin on public.recurring for all to authenticated
  using (public.can_admin_dompet(dompet_id) and public.can_see_account(account_id))
  with check (public.can_admin_dompet(dompet_id) and public.can_see_account(account_id)
              and public.tx_refs_ok(dompet_id, account_id, category_id, paid_by));
drop policy if exists recurring_advance on public.recurring;
create policy recurring_advance on public.recurring for update to authenticated
  using (public.can_write_dompet(dompet_id) and public.can_see_account(account_id))
  with check (public.can_write_dompet(dompet_id) and public.can_see_account(account_id));

-- activity: members read; anyone who can act writes entries as themselves.
drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (public.is_dompet_member(dompet_id));
drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert to authenticated
  with check (member_id = public.my_member_id(dompet_id)
              and (public.can_write_dompet(dompet_id)));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on public.accounts, public.categories, public.transactions, public.budgets, public.activity, public.loans, public.recurring from anon;
grant select, insert, update, delete on public.accounts, public.categories, public.transactions, public.budgets, public.loans to authenticated;
grant select, insert, delete on public.recurring to authenticated;
grant update on public.recurring to authenticated;
-- Members (non-admins) can only touch next_date/active via recurring_advance;
-- a trigger stops them changing anything else.
create or replace function public.recurring_member_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.can_admin_dompet(old.dompet_id) and (
       new.name, new.icon, new.kind, new.amount, new.account_id, new.category_id, new.paid_by,
       new.frequency, new.every, new.end_date, new.dompet_id
     ) is distinct from (
       old.name, old.icon, old.kind, old.amount, old.account_id, old.category_id, old.paid_by,
       old.frequency, old.every, old.end_date, old.dompet_id
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists recurring_guard on public.recurring;
create trigger recurring_guard before update on public.recurring
  for each row execute function public.recurring_member_guard();
grant select, insert on public.activity to authenticated;

revoke execute on function
  public.my_member_id(uuid), public.member_in_dompet(uuid, uuid),
  public.can_see_account(uuid), public.tx_refs_ok(uuid, uuid, uuid, uuid)
from public, anon;
grant execute on function
  public.my_member_id(uuid), public.member_in_dompet(uuid, uuid),
  public.can_see_account(uuid), public.tx_refs_ok(uuid, uuid, uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- create_dompet now also seeds default categories and a cash account.
-- ---------------------------------------------------------------------------
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
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.dompets (name, currency, icon, colour, created_by)
  values (trim(p_name), coalesce(nullif(trim(p_currency), ''), 'IDR'), p_icon, p_colour, v_uid)
  returning * into v_dompet;

  insert into public.dompet_members (dompet_id, user_id, role, display_name, colour)
  values (v_dompet.id, v_uid, 'owner', public.default_display_name(v_uid), '#f47c5a')
  returning id into v_member;

  insert into public.categories (dompet_id, name, icon, colour, kind, sort_order)
  select v_dompet.id, c.name, c.icon, c.colour, c.kind, c.ord
  from (values
    ('Makan & Minum','🍜','#f97316','expense',0), ('Belanja Dapur','🛒','#16a34a','expense',1),
    ('Transportasi','🛵','#2563eb','expense',2), ('Listrik & Air','💡','#eab308','expense',3),
    ('Pulsa & Internet','📶','#06b6d4','expense',4), ('Sekolah','🎒','#8b5cf6','expense',5),
    ('Kesehatan','💊','#ef4444','expense',6), ('Hiburan','🎬','#ec4899','expense',7),
    ('Arisan','🤝','#14b8a6','expense',8), ('Zakat & Sedekah','🤲','#84cc16','expense',9),
    ('Lainnya','📦','#94a3b8','expense',10), ('Gaji','💼','#0f766e','income',11),
    ('Bonus','🎁','#d97706','income',12), ('Usaha','🏪','#7c3aed','income',13),
    ('Pemasukan Lain','💰','#64748b','income',14)
  ) as c(name, icon, colour, kind, ord);

  insert into public.accounts (dompet_id, name, type, colour, created_by)
  values (v_dompet.id, 'Dompet Tunai', 'cash', '#f47c5a', v_member);

  insert into public.activity (dompet_id, member_id, message)
  values (v_dompet.id, v_member, format('membuat Dompet "%s"', v_dompet.name));

  return v_dompet;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime + PowerSync publications
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['dompets','dompet_members','accounts','categories','transactions','budgets','activity','loans','recurring'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
  if exists (select 1 from pg_publication where pubname = 'powersync') then
    foreach t in array array['accounts','categories','transactions','budgets','activity','loans','recurring'] loop
      begin
        execute format('alter publication powersync add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ===== supabase/migrations/20261113000000_phone_login.sql =====
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

-- ===== supabase/migrations/20261113010000_phone_register.sql =====
-- Sedompet: register phone accounts inside the database.
--
-- Supabase Auth's public sign-up rejects the synthetic login address
-- (6281...@phone.sedompet.app) because that domain has no mail server.
-- Sign-in with a password does not do that check, so we create the auth user
-- here and the app then signs in normally with number + PIN.
--
-- Who may register:
--   * numbers the admin activated (admin_activate_phone), or
--   * anyone with a valid invite code: the code activates the number and
--     reserves their place in that Dompet (consumes one use of the code).
-- A number the admin deactivated cannot re-activate itself with a code.

drop function if exists public.register_phone(text, text);

create or replace function public.register_phone(
  p_phone text,
  p_pin text,
  p_invite_code text default null,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_email text;
  v_uid uuid := gen_random_uuid();
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.dompet_invites;
  v_access public.phone_access;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  v_email := v_phone || '@phone.sedompet.app';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;

  if v_code <> '' then
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    -- An explicit admin deactivation wins over an invite.
    if v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
      raise exception 'phone_not_activated' using errcode = '42501';
    end if;
    insert into public.phone_access (phone, activated, activated_at, note)
    values (v_phone, true, now(), 'invite ' || v_code)
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      note = coalesce(public.phone_access.note, excluded.note);

    insert into public.dompet_members (dompet_id, phone, role, display_name)
    values (v_invite.dompet_id, v_phone, v_invite.role, nullif(left(trim(coalesce(p_display_name, '')), 60), ''))
    on conflict do nothing;
    update public.dompet_invites set uses = uses + 1 where code = v_code;
  elsif not public.phone_is_activated(v_phone) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('phone', v_phone, 'full_name', nullif(trim(coalesce(p_display_name, '')), '')),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );
end $$;

revoke execute on function public.register_phone(text, text, text, text) from public;
grant execute on function public.register_phone(text, text, text, text) to anon, authenticated;

-- ===== supabase/migrations/20261114000000_app_admin.sql =====
-- Sedompet: app admin + single-use activation codes.
--
-- An activation code lets ONE new person register with their phone number
-- (no manual activation needed). They then create their own Dompet.
-- Invite codes (6 chars, dompet_invites) still join an existing Dompet;
-- activation codes are 8 chars so the two never collide.
--
-- Make yourself app admin once, in the SQL Editor:
--   select admin_grant_app_admin('0812xxxxxxxx');

create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create table if not exists public.activation_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{8}$'),
  note        text check (note is null or char_length(note) <= 80),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  revoked     boolean not null default false,
  used_phone  text,
  used_at     timestamptz
);
alter table public.activation_codes enable row level security;
revoke all on public.activation_codes from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- SQL Editor only: make a registered phone account an app admin.
create or replace function public.admin_grant_app_admin(p_phone text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid;
begin
  select id into v_uid from auth.users where email = public.normalize_phone(p_phone) || '@phone.sedompet.app';
  if v_uid is null then
    raise exception 'Nomor % belum terdaftar. Daftar dulu di aplikasi.', p_phone;
  end if;
  insert into public.app_admins (user_id) values (v_uid) on conflict do nothing;
  return 'ok';
end $$;
revoke execute on function public.admin_grant_app_admin(text) from public, anon, authenticated;

create or replace function public.require_app_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_app_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.require_app_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs (app admins only)
-- ---------------------------------------------------------------------------
create or replace function public.app_create_activation_code(p_note text default null, p_valid_days int default 30)
returns public.activation_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_row public.activation_codes;
  i int;
begin
  perform public.require_app_admin();
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      -- bytes 0..5 and 9..10 of a v4 uuid are fully random
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, case when i < 6 then i else i + 3 end) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into public.activation_codes (code, note, created_by, expires_at)
      values (v_code, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
              now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 30), 365))))
      returning * into v_row;
      return v_row;
    exception when unique_violation then
    end;
  end loop;
end $$;

create or replace function public.app_list_activation_codes()
returns setof public.activation_codes
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query select * from public.activation_codes order by created_at desc limit 200;
end $$;

create or replace function public.app_revoke_activation_code(p_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  update public.activation_codes set revoked = true where code = upper(p_code) and used_at is null;
end $$;

-- Everyone who can log in (or was activated), for the admin page.
-- (Dropped first: a later migration adds columns, and re-running this file
-- must not fail on the changed return type.)
drop function if exists public.app_list_phones();
create or replace function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id))
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;

create or replace function public.app_set_phone_active(p_phone text, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_phone text := public.normalize_phone(p_phone);
begin
  perform public.require_app_admin();
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if not p_active and v_phone = public.phone_from_email(auth.jwt() ->> 'email') then
    raise exception 'cannot_deactivate_self' using errcode = '22023';
  end if;
  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, p_active, now(), 'admin')
  on conflict (phone) do update set activated = p_active, activated_at = now();
end $$;

revoke execute on function
  public.app_create_activation_code(text, int), public.app_list_activation_codes(),
  public.app_revoke_activation_code(text), public.app_list_phones(), public.app_set_phone_active(text, boolean)
from public, anon;
grant execute on function
  public.app_create_activation_code(text, int), public.app_list_activation_codes(),
  public.app_revoke_activation_code(text), public.app_list_phones(), public.app_set_phone_active(text, boolean)
to authenticated;

-- ---------------------------------------------------------------------------
-- register_phone: now also accepts an 8-char activation code.
-- (Same signature as before, so no drop is needed.)
-- ---------------------------------------------------------------------------
create or replace function public.register_phone(
  p_phone text,
  p_pin text,
  p_invite_code text default null,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_email text;
  v_uid uuid := gen_random_uuid();
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.dompet_invites;
  v_act public.activation_codes;
  v_access public.phone_access;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  v_email := v_phone || '@phone.sedompet.app';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;
  -- An explicit admin deactivation wins over any code.
  if v_code <> '' and v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  if length(v_code) = 8 then
    -- Single-use activation code: activates this number, nothing else.
    select * into v_act from public.activation_codes where code = v_code for update;
    if not found or v_act.revoked or v_act.used_at is not null or v_act.expires_at < now() then
      raise exception 'invalid_activation_code' using errcode = '22023';
    end if;
    update public.activation_codes set used_phone = v_phone, used_at = now() where code = v_code;
    insert into public.phone_access (phone, activated, activated_at, note)
    values (v_phone, true, now(), coalesce('kode ' || v_code || coalesce(' · ' || v_act.note, ''), 'kode'))
    on conflict (phone) do update set activated = true, activated_at = coalesce(public.phone_access.activated_at, now());

  elsif v_code <> '' then
    -- Dompet invite: activates the number and reserves the seat.
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    insert into public.phone_access (phone, activated, activated_at, note)
    values (v_phone, true, now(), 'invite ' || v_code)
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      note = coalesce(public.phone_access.note, excluded.note);
    insert into public.dompet_members (dompet_id, phone, role, display_name)
    values (v_invite.dompet_id, v_phone, v_invite.role, nullif(left(trim(coalesce(p_display_name, '')), 60), ''))
    on conflict do nothing;
    update public.dompet_invites set uses = uses + 1 where code = v_code;

  elsif not public.phone_is_activated(v_phone) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('phone', v_phone, 'full_name', nullif(trim(coalesce(p_display_name, '')), '')),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );
end $$;

revoke execute on function public.register_phone(text, text, text, text) from public;
grant execute on function public.register_phone(text, text, text, text) to anon, authenticated;

-- The admin page reads activation codes through RPCs only; no realtime needed.

-- ===== supabase/migrations/20261115000000_account_holder.sql =====
-- Sedompet: account holders and members who haven't joined yet.
--
-- * accounts.holder_member_id: whose account it is ("Dipegang oleh").
--   The holder may edit the account (name/icon/colour/opening balance) and
--   edit or delete ANY transaction in it, including ones others logged on
--   their behalf before they joined. Owners/admins keep full control.
-- * Pending members: a Dompet admin can add someone by phone + name before
--   they join (placeholder dompet_members row, user_id NULL). The number is
--   activated so they can register; when they do, claim_phone_membership()
--   links the placeholder, so they inherit their accounts and history.
-- * assign_account(): hand an account to a member, shared with the family
--   or private to them, optionally moving "paid by" on past transactions.

alter table public.accounts
  add column if not exists holder_member_id uuid references public.dompet_members (id) on delete set null;
create index if not exists accounts_holder_idx on public.accounts (holder_member_id);

-- Holder (and private owner) must belong to the same Dompet.
create or replace function public.check_account_people()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.member_in_dompet(new.holder_member_id, new.dompet_id)
     or not public.member_in_dompet(new.owner_member_id, new.dompet_id) then
    raise exception 'member_not_in_dompet' using errcode = '22023';
  end if;
  -- A private account is always held by its owner.
  if new.visibility = 'private' then
    new.holder_member_id := new.owner_member_id;
  end if;
  return new;
end $$;
drop trigger if exists accounts_people_check on public.accounts;
create trigger accounts_people_check before insert or update on public.accounts
  for each row execute function public.check_account_people();

-- Does the caller hold this account?
create or replace function public.holds_account(p_account_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.accounts a
    where a.id = p_account_id
      and public.can_write_dompet(a.dompet_id)
      and coalesce(a.holder_member_id, a.owner_member_id) = public.my_member_id(a.dompet_id)
  )
$$;
revoke execute on function public.holds_account(uuid) from public, anon;
grant execute on function public.holds_account(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Holders may edit transactions in their account.
-- ---------------------------------------------------------------------------
drop policy if exists transactions_update on public.transactions;
create policy transactions_update on public.transactions for update to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or public.holds_account(account_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  )
  with check (
    public.can_see_account(account_id)
    and updated_by = public.my_member_id(dompet_id)
    and public.tx_refs_ok(dompet_id, account_id, category_id, paid_by)
  );

drop policy if exists transactions_delete on public.transactions;
create policy transactions_delete on public.transactions for delete to authenticated
  using (
    public.can_see_account(account_id)
    and (public.can_admin_dompet(dompet_id)
         or public.holds_account(account_id)
         or (public.can_write_dompet(dompet_id) and created_by = public.my_member_id(dompet_id)))
  );

-- Holders may tidy up their shared account, but not change who holds it,
-- who can see it, or move it to another Dompet (trigger below).
drop policy if exists accounts_holder_update on public.accounts;
create policy accounts_holder_update on public.accounts for update to authenticated
  using (visibility = 'shared' and public.holds_account(id))
  with check (visibility = 'shared' and holder_member_id = public.my_member_id(dompet_id));

create or replace function public.accounts_holder_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.can_admin_dompet(old.dompet_id)
     and old.visibility = 'shared'
     and (new.visibility, new.owner_member_id, new.holder_member_id, new.dompet_id)
         is distinct from (old.visibility, old.owner_member_id, old.holder_member_id, old.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists accounts_holder_guard on public.accounts;
create trigger accounts_holder_guard before update on public.accounts
  for each row execute function public.accounts_holder_guard();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Hand an account to a member (or back to "the family" with p_member_id NULL).
--   shared: everyone sees it, the member is its holder.
--   private: only the member sees it (and its transactions).
-- Allowed for Dompet admins, and for the current private owner/holder.
create or replace function public.assign_account(
  p_account_id uuid,
  p_member_id uuid,
  p_visibility text default 'shared',
  p_reassign_paid_by boolean default false
) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  a public.accounts;
  v_me uuid;
  v_count int := 0;
begin
  select * into a from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;
  v_me := public.my_member_id(a.dompet_id);
  if v_me is null or not (
       public.can_admin_dompet(a.dompet_id)
       or (a.visibility = 'private' and a.owner_member_id = v_me)
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_visibility not in ('shared', 'private') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  -- Only owners/admins decide what the whole family sees.
  if p_visibility = 'shared' and not public.can_admin_dompet(a.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_visibility = 'private' and p_member_id is null then
    raise exception 'private_needs_member' using errcode = '22023';
  end if;
  if not public.member_in_dompet(p_member_id, a.dompet_id) then
    raise exception 'member_not_in_dompet' using errcode = '22023';
  end if;

  update public.accounts set
    visibility = p_visibility,
    owner_member_id = case when p_visibility = 'private' then p_member_id end,
    holder_member_id = p_member_id
  where id = p_account_id;

  if p_reassign_paid_by and p_member_id is not null then
    update public.transactions set paid_by = p_member_id, updated_by = v_me, updated_at = now()
    where account_id = p_account_id and paid_by is distinct from p_member_id and flag is null;
    get diagnostics v_count = row_count;
  end if;

  insert into public.activity (dompet_id, member_id, message)
  select a.dompet_id, v_me,
         format('menyerahkan akun %s kepada %s', a.name, coalesce(m.display_name, 'anggota'))
  from public.dompet_members m where m.id = p_member_id;
  return v_count;
end $$;

-- Add someone who hasn't joined yet (by phone). Their number is activated so
-- they can register; their seat (and anything assigned to it) waits for them.
create or replace function public.add_pending_member(
  p_dompet_id uuid,
  p_phone text,
  p_display_name text,
  p_role public.dompet_role default 'member'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_access public.phone_access;
  v_uid uuid;
  v_id uuid;
  v_caller public.dompet_role := public.dompet_role_of(p_dompet_id);
begin
  if v_caller is null or v_caller not in ('owner', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role = 'owner' or (p_role = 'admin' and v_caller <> 'owner') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;
  if v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
    raise exception 'phone_not_activated' using errcode = '42501';  -- blocked by the app admin
  end if;
  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, true, now(), 'ditambahkan ke Dompet')
  on conflict (phone) do update set activated = true,
    activated_at = coalesce(public.phone_access.activated_at, now());

  -- Already has an account? Link straight away.
  select id into v_uid from auth.users where email = v_phone || '@phone.sedompet.app';
  if exists (select 1 from public.dompet_members where dompet_id = p_dompet_id
             and (phone = v_phone or (v_uid is not null and user_id = v_uid))) then
    raise exception 'already_member' using errcode = '23505';
  end if;

  insert into public.dompet_members (dompet_id, phone, role, display_name, user_id)
  values (p_dompet_id, v_phone, p_role, left(trim(p_display_name), 60), v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Remove someone who hasn't joined yet (joined members use remove_dompet_member).
create or replace function public.remove_pending_member(p_member_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare m public.dompet_members;
begin
  select * into m from public.dompet_members where id = p_member_id;
  if not found then return; end if;
  if m.user_id is not null then
    raise exception 'use_remove_dompet_member' using errcode = '22023';
  end if;
  if not public.can_admin_dompet(m.dompet_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.dompet_members where id = p_member_id;
end $$;

revoke execute on function
  public.assign_account(uuid, uuid, text, boolean),
  public.add_pending_member(uuid, text, text, public.dompet_role),
  public.remove_pending_member(uuid)
from public, anon;
grant execute on function
  public.assign_account(uuid, uuid, text, boolean),
  public.add_pending_member(uuid, text, text, public.dompet_role),
  public.remove_pending_member(uuid)
to authenticated;

-- ===== supabase/migrations/20261116000000_transfers.sql =====
-- Sedompet: link the two sides of a transfer (and its optional admin fee).
--
-- A transfer is stored as two transactions with flag = 'transfer' (an expense
-- from the source account, an income into the destination) plus, optionally,
-- a normal expense for the bank's admin fee. All share one transfer_id so the
-- app can edit or delete them together. Existing RLS applies to each row.

alter table public.transactions add column if not exists transfer_id uuid;
create index if not exists transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;

-- ===== supabase/migrations/20261117000000_budget_period.sql =====
-- Sedompet: budgets can be daily, weekly (Mon-Sun) or monthly.
alter table public.budgets add column if not exists period text not null default 'monthly';
do $$ begin
  alter table public.budgets add constraint budgets_period_check check (period in ('daily', 'weekly', 'monthly'));
exception when duplicate_object then null; end $$;

-- ===== supabase/migrations/20261118000000_budget_categories.sql =====
-- Sedompet: a budget can cover several categories (category_id stays for a single one).
alter table public.budgets add column if not exists category_ids uuid[] not null default '{}';

-- ===== supabase/migrations/20261119000000_account_currency.sql =====
-- Sedompet: custom account types and multi-currency accounts.
--
-- * accounts.type: no longer limited to cash/bank/ewallet/savings. Any short
--   group name works ("credit", "investment", or something the family typed
--   like "Emas"); the app groups accounts by it with a subtotal per group.
-- * accounts.currency: the account's currency (ISO code). Amounts on the
--   account (opening balance, transactions, loans, recurring) are stored as
--   integer minor units of it (cents for USD, rupiah for IDR).
-- * accounts.fx_rate: rupiah per 1 unit of `currency`, set by the family; the
--   app uses it to show totals and reports in rupiah.

alter table public.accounts drop constraint if exists accounts_type_check;
do $$ begin
  alter table public.accounts add constraint accounts_type_check check (char_length(type) between 1 and 30);
exception when duplicate_object then null; end $$;

alter table public.accounts add column if not exists currency text not null default 'IDR';
alter table public.accounts add column if not exists fx_rate numeric not null default 1;
do $$ begin
  alter table public.accounts add constraint accounts_currency_check check (currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.accounts add constraint accounts_fx_rate_check check (fx_rate > 0);
exception when duplicate_object then null; end $$;

-- ===== supabase/migrations/20261120000000_goals.sql =====
-- Sedompet: savings goals ("Tabungan tujuan").
--
-- A goal has a target in rupiah and optionally a target date. Progress comes
-- from a linked account's balance when account_id is set, otherwise from
-- `saved`, which members top up by hand ("Setor" / "Ambil").
--   * Everyone in the Dompet sees goals, except a goal linked to a private
--     account, which only that account's owner sees.
--   * Owner/admin create, edit and delete goals; members may update them
--     (the app only lets members change `saved`).

create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  dompet_id    uuid not null references public.dompets (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  icon         text not null default '🎯' check (char_length(icon) <= 60000),
  target       bigint not null check (target > 0),
  target_date  date,
  account_id   uuid references public.accounts (id) on delete set null,
  saved        bigint not null default 0,
  created_by   uuid references public.dompet_members (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists goals_dompet_idx on public.goals (dompet_id);

alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (public.is_dompet_member(dompet_id) and (account_id is null or public.can_see_account(account_id)));

drop policy if exists goals_admin on public.goals;
create policy goals_admin on public.goals for all to authenticated
  using (public.can_admin_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)))
  with check (
    public.can_admin_dompet(dompet_id)
    and (account_id is null or exists (
      select 1 from public.accounts a where a.id = account_id and a.dompet_id = goals.dompet_id
    ) and public.can_see_account(account_id))
  );

drop policy if exists goals_member_update on public.goals;
create policy goals_member_update on public.goals for update to authenticated
  using (public.can_write_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)))
  with check (public.can_write_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)));

revoke all on public.goals from anon;
grant select, insert, update, delete on public.goals to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.goals;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ===== supabase/migrations/20261121000000_subscription.sql =====
-- Sedompet: paid plans (Bulanan / Tahunan) with an expiry date.
--
-- * phone_access.plan / active_until say what a number has paid for.
--     plan NULL + active_until NULL  -> legacy / admin-activated: no expiry
--     'gratis'                       -> free, no expiry (set by admin)
--     'bulanan' / 'tahunan'          -> paid until active_until
--     'anggota'                      -> joined via invite: may use Dompets it
--                                       was invited to, not its own (until it buys)
-- * A Dompet is "active" while at least one of its owners has access.
--   Writes to finance tables of an inactive Dompet are rejected (read-only);
--   reading, exporting and deleting stay possible.
-- * Activation codes can carry a plan + months, applied when the code is used.
-- * Admins extend a number from the admin page (app_set_subscription).

alter table public.phone_access add column if not exists plan text;
alter table public.phone_access add column if not exists active_until timestamptz;
do $$ begin
  alter table public.phone_access add constraint phone_access_plan_check
    check (plan is null or plan in ('gratis', 'bulanan', 'tahunan', 'anggota'));
exception when duplicate_object then null; end $$;

alter table public.activation_codes add column if not exists plan text;
alter table public.activation_codes add column if not exists months int;
do $$ begin
  alter table public.activation_codes add constraint activation_codes_plan_check
    check ((plan is null and months is null)
        or (plan = 'gratis' and months is null)
        or (plan in ('bulanan', 'tahunan') and months between 1 and 36));
exception when duplicate_object then null; end $$;

-- Does this phone_access row pay for Dompets it owns?
create or replace function public.access_is_paid(a public.phone_access)
returns boolean
language sql immutable set search_path = ''
as $$
  select a.activated and (
    a.plan = 'gratis'
    or (a.plan is null and a.active_until is null)
    or a.active_until > now()
  )
$$;
revoke execute on function public.access_is_paid(public.phone_access) from public, anon, authenticated;

-- When does this Dompet's access end? NULL = never. Owners without a
-- phone_access row (older email accounts) count as unlimited.
create or replace function public.dompet_active_until(p_dompet_id uuid)
returns timestamptz
language sql stable security definer set search_path = ''
as $$
  with owners as (
    select a as acc
    from public.dompet_members m
    left join auth.users u on u.id = m.user_id
    left join public.phone_access a
      on a.phone = coalesce(m.phone, public.phone_from_email(u.email))
    where m.dompet_id = p_dompet_id and m.role = 'owner'
  )
  select case
    when exists (select 1 from owners o where (o.acc).phone is null) then null
    when exists (select 1 from owners o where (o.acc).activated and ((o.acc).plan = 'gratis' or ((o.acc).plan is null and (o.acc).active_until is null))) then null
    else coalesce(
      (select max((o.acc).active_until) from owners o where (o.acc).activated),
      '-infinity'::timestamptz)
  end
$$;
revoke execute on function public.dompet_active_until(uuid) from public, anon, authenticated;

create or replace function public.dompet_is_active(p_dompet_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.dompet_active_until(p_dompet_id) > now(), true)
$$;
revoke execute on function public.dompet_is_active(uuid) from public, anon, authenticated;

-- Read-only guard for finance tables. Admin SQL (no JWT) is not affected.
create or replace function public.require_active_dompet()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.dompet_is_active(new.dompet_id) then
    raise exception 'subscription_expired' using errcode = '42501',
      hint = 'Langganan Dompet ini sudah berakhir. Perpanjang lewat admin untuk mencatat lagi.';
  end if;
  return new;
end $$;
revoke execute on function public.require_active_dompet() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','transactions','budgets','loans','recurring','goals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_active_dompet', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.require_active_dompet()', t || '_active_dompet', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- For the app: status of every Dompet I belong to, and my own plan.
-- ---------------------------------------------------------------------------
create or replace function public.my_subscription()
returns table (dompet_id uuid, active_until timestamptz, is_active boolean, my_plan text, my_active_until timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.dompet_id,
         nullif(public.dompet_active_until(m.dompet_id), '-infinity'::timestamptz),
         public.dompet_is_active(m.dompet_id),
         a.plan, a.active_until
  from public.dompet_members m
  left join public.phone_access a on a.phone = public.phone_from_email(auth.jwt() ->> 'email')
  where m.user_id = auth.uid()
$$;
revoke execute on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- ---------------------------------------------------------------------------
-- Admin: set / extend a plan. Months are added to whatever is left, so
-- paying early never loses days. p_plan 'gratis' = no expiry,
-- 'berhenti' = end access now.
-- ---------------------------------------------------------------------------
create or replace function public.app_set_subscription(p_phone text, p_plan text, p_months int default null)
returns public.phone_access
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_row public.phone_access;
begin
  perform public.require_app_admin();
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if p_plan in ('bulanan', 'tahunan') and coalesce(p_months, 0) not between 1 and 36 then
    raise exception 'invalid_months' using errcode = '22023';
  end if;
  if p_plan not in ('bulanan', 'tahunan', 'gratis', 'berhenti') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;

  insert into public.phone_access (phone, activated, activated_at, note)
  values (v_phone, true, now(), 'admin')
  on conflict (phone) do nothing;

  update public.phone_access a set
    activated = case when p_plan = 'berhenti' then a.activated else true end,
    activated_at = coalesce(a.activated_at, now()),
    plan = case when p_plan = 'berhenti' then coalesce(a.plan, 'bulanan') else p_plan end,
    active_until = case
      when p_plan = 'gratis' then null
      when p_plan = 'berhenti' then now()
      else greatest(now(), coalesce(a.active_until, now())) + make_interval(months => p_months)
    end
  where a.phone = v_phone
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.app_set_subscription(text, text, int) from public, anon;
grant execute on function public.app_set_subscription(text, text, int) to authenticated;

-- Admin list: now with plan + expiry (return type changed, so drop first).
drop function if exists public.app_list_phones();
create function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint,
  plan text, active_until timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id)),
         a.plan, a.active_until
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;
revoke execute on function public.app_list_phones() from public, anon;
grant execute on function public.app_list_phones() to authenticated;

-- Activation codes can carry a plan (replaces the 2-argument version).
drop function if exists public.app_create_activation_code(text, int);
create or replace function public.app_create_activation_code(
  p_note text default null, p_valid_days int default 30, p_plan text default null, p_months int default null
)
returns public.activation_codes
language plpgsql security definer set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
  v_row public.activation_codes;
  i int;
begin
  perform public.require_app_admin();
  if p_plan is not null and p_plan not in ('gratis', 'bulanan', 'tahunan') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, case when i < 6 then i else i + 3 end) % length(v_alphabet)), 1);
    end loop;
    begin
      insert into public.activation_codes (code, note, created_by, expires_at, plan, months)
      values (v_code, nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
              now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 30), 365))),
              p_plan, case when p_plan in ('bulanan', 'tahunan') then p_months end)
      returning * into v_row;
      return v_row;
    exception when unique_violation then
    end;
  end loop;
end $$;
revoke execute on function public.app_create_activation_code(text, int, text, int) from public, anon;
grant execute on function public.app_create_activation_code(text, int, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- register_phone: activation codes apply their plan; invitees get 'anggota'.
-- (Same signature, so create or replace.)
-- ---------------------------------------------------------------------------
create or replace function public.register_phone(
  p_phone text,
  p_pin text,
  p_invite_code text default null,
  p_display_name text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_email text;
  v_uid uuid := gen_random_uuid();
  v_code text := upper(regexp_replace(coalesce(p_invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_invite public.dompet_invites;
  v_act public.activation_codes;
  v_access public.phone_access;
begin
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then
    raise exception 'invalid_pin' using errcode = '22023';
  end if;
  if v_phone !~ '^62[0-9]{8,13}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  v_email := v_phone || '@phone.sedompet.app';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'phone_already_registered' using errcode = '23505';
  end if;

  select * into v_access from public.phone_access where phone = v_phone for update;
  -- An explicit admin deactivation wins over any code.
  if v_code <> '' and v_access.phone is not null and not v_access.activated and v_access.activated_at is not null then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  if length(v_code) = 8 then
    -- Single-use activation code: activates this number, nothing else.
    select * into v_act from public.activation_codes where code = v_code for update;
    if not found or v_act.revoked or v_act.used_at is not null or v_act.expires_at < now() then
      raise exception 'invalid_activation_code' using errcode = '22023';
    end if;
    update public.activation_codes set used_phone = v_phone, used_at = now() where code = v_code;
    insert into public.phone_access (phone, activated, activated_at, note, plan, active_until)
    values (v_phone, true, now(), coalesce('kode ' || v_code || coalesce(' · ' || v_act.note, ''), 'kode'),
            v_act.plan, case when v_act.months is not null then now() + make_interval(months => v_act.months) end)
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      plan = coalesce(excluded.plan, public.phone_access.plan),
      active_until = coalesce(excluded.active_until, public.phone_access.active_until);

  elsif v_code <> '' then
    -- Dompet invite: activates the number and reserves the seat.
    select * into v_invite from public.dompet_invites where code = v_code for update;
    if not found or v_invite.revoked or v_invite.expires_at < now() or v_invite.uses >= v_invite.max_uses then
      raise exception 'invalid_invite' using errcode = '22023';
    end if;
    -- Joining someone's Dompet is free, but does not pay for Dompets of your own.
    insert into public.phone_access (phone, activated, activated_at, note, plan)
    values (v_phone, true, now(), 'invite ' || v_code, 'anggota')
    on conflict (phone) do update set activated = true,
      activated_at = coalesce(public.phone_access.activated_at, now()),
      note = coalesce(public.phone_access.note, excluded.note);
    insert into public.dompet_members (dompet_id, phone, role, display_name)
    values (v_invite.dompet_id, v_phone, v_invite.role, nullif(left(trim(coalesce(p_display_name, '')), 60), ''))
    on conflict do nothing;
    update public.dompet_invites set uses = uses + 1 where code = v_code;

  elsif not public.phone_is_activated(v_phone) then
    raise exception 'phone_not_activated' using errcode = '42501';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_pin, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('phone', v_phone, 'full_name', nullif(trim(coalesce(p_display_name, '')), '')),
    now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_uid, v_uid::text, 'email',
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );
end $$;

revoke execute on function public.register_phone(text, text, text, text) from public;
grant execute on function public.register_phone(text, text, text, text) to anon, authenticated;

-- Make the Supabase API pick up new/changed functions and columns right away.
notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261122000000_period_start.sql =====
-- Sedompet: a Dompet's budget month can start on payday (1-28) instead of the 1st.
-- Budgets, reports and "sisa per hari" use this period. Owners/admins change
-- it in the app (same rule as renaming the Dompet).
alter table public.dompets add column if not exists period_start_day smallint not null default 1;
do $$ begin
  alter table public.dompets add constraint dompets_period_start_day_check check (period_start_day between 1 and 28);
exception when duplicate_object then null; end $$;
grant update (period_start_day) on public.dompets to authenticated;

-- Make the Supabase API pick up new/changed functions and columns right away.
notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261123000000_split_expenses.sql =====
-- Sedompet: shared / split expenses ("patungan").
--
-- transactions.split_with = who an expense is for, as a JSON array of
--   {"m": <dompet_members.id>, "a": <share in the account's minor units>}
-- The payer is paid_by as before. Shares must add up to the amount.
-- Balances: the payer is owed the amount, each member owes their share.
-- Settling up is a transfer whose outgoing side is paid by the debtor and
-- split entirely to the creditor (same maths, no extra table).

alter table public.transactions add column if not exists split_with jsonb;

create or replace function public.check_transaction_split()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_sum bigint;
  v_count int;
  v_bad int;
begin
  if new.split_with is null then
    return new;
  end if;
  if jsonb_typeof(new.split_with) <> 'array' or new.kind <> 'expense' then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  select count(*), coalesce(sum((e ->> 'a')::bigint), 0),
         count(*) filter (where
           (e ->> 'a') is null or (e ->> 'a') !~ '^[0-9]+$' or (e ->> 'a')::bigint <= 0
           or (e ->> 'm') is null
           or not exists (select 1 from public.dompet_members m where m.id::text = e ->> 'm' and m.dompet_id = new.dompet_id))
    into v_count, v_sum, v_bad
  from jsonb_array_elements(new.split_with) e;
  if v_count < 1 or v_count > 30 or v_bad > 0 or v_sum <> new.amount then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  if (select count(distinct e ->> 'm') from jsonb_array_elements(new.split_with) e) <> v_count then
    raise exception 'invalid_split' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.check_transaction_split() from public, anon, authenticated;

drop trigger if exists transactions_split_check on public.transactions;
create trigger transactions_split_check before insert or update of split_with, amount, kind on public.transactions
  for each row execute function public.check_transaction_split();

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261124000000_transaction_details.sql =====
-- Sedompet: richer transactions.
--   need          'need' (kebutuhan) / 'want' (keinginan), optional
--   merchant      where it was bought, optional
--   receipt_path  receipt photo in the private 'receipts' storage bucket,
--                 stored as '<dompet_id>/<uuid>.jpg'
-- Only members of that Dompet can read/upload/delete its receipt photos.

alter table public.transactions add column if not exists need text;
alter table public.transactions add column if not exists merchant text;
alter table public.transactions add column if not exists receipt_path text;
do $$ begin
  alter table public.transactions add constraint transactions_need_check check (need is null or need in ('need', 'want'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions add constraint transactions_merchant_check check (merchant is null or char_length(merchant) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.transactions add constraint transactions_receipt_path_check
    check (receipt_path is null or (receipt_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and split_part(receipt_path, '/', 1) = dompet_id::text));
exception when duplicate_object then null; end $$;

-- Receipt photos (Supabase Storage). Skipped where there is no storage schema (local tests).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 2097152, array['image/jpeg'])
    on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

    execute 'drop policy if exists receipts_select on storage.objects';
    execute 'drop policy if exists receipts_insert on storage.objects';
    execute 'drop policy if exists receipts_delete on storage.objects';
    execute $p$create policy receipts_select on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and public.is_dompet_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts'
        and public.is_dompet_member(((storage.foldername(name))[1])::uuid,
                                    array['owner','admin','member']::public.dompet_role[]))$p$;
    execute $p$create policy receipts_delete on storage.objects for delete to authenticated
      using (bucket_id = 'receipts'
        and public.is_dompet_member(((storage.foldername(name))[1])::uuid,
                                    array['owner','admin','member']::public.dompet_role[]))$p$;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261125000000_push.sql =====
-- Sedompet: web push notifications.
--
-- * push_subscriptions: one row per browser/device that allowed notifications,
--   with the person's choices (prefs). Managed through push_subscribe() etc.
-- * Shared-account entries are queued by a trigger (push_queue).
-- * push_collect() (service role only) decides what to send right now and
--   returns one row per (device, message). It remembers what was sent in
--   push_sent so daily/weekly messages go out once. The 'send-push' Edge
--   Function calls it every few minutes (see SETUP-PUSH.md) and delivers.
--
-- Messages: someone else recorded an entry, Rutin bill due today/tomorrow,
-- loan due today/tomorrow, total monthly budget at 80% / 100%, Monday weekly
-- recap, Sedompet plan ending in 7 days / 1 day / today.
-- Times are Asia/Jakarta.

-- ---------------------------------------------------------------------------
-- Config readable by the app (the VAPID public key)
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
drop policy if exists app_config_public on public.app_config;
create policy app_config_public on public.app_config for select to authenticated using (key in ('vapid_public_key'));

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  prefs       jsonb not null default '{"entries": true, "bills": true, "budget": true, "weekly": true, "plan": true}',
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- Register (or move to me) this browser's subscription.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb default null, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, prefs, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth,
          coalesce(p_prefs, '{"entries": true, "bills": true, "budget": true, "weekly": true, "plan": true}'), left(p_user_agent, 200))
  on conflict (endpoint) do update set
    user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = coalesce(p_prefs, public.push_subscriptions.prefs), user_agent = excluded.user_agent;
end $$;

create or replace function public.push_set_prefs(p_endpoint text, p_prefs jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update public.push_subscriptions set prefs = p_prefs where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

revoke execute on function public.push_subscribe(text, text, text, jsonb, text), public.push_set_prefs(text, jsonb), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, jsonb, text), public.push_set_prefs(text, jsonb), public.push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Queue of new shared entries ("Ibu mencatat ...")
-- ---------------------------------------------------------------------------
create table if not exists public.push_queue (
  id          bigserial primary key,
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  member_id   uuid references public.dompet_members (id) on delete cascade,
  kind        text not null,
  amount_idr  bigint not null,
  label       text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;

create table if not exists public.push_sent (
  key      text primary key,
  sent_at  timestamptz not null default now()
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- Rupiah value of an amount on an account (minor units for 2-decimal currencies).
create or replace function public.push_idr(p_amount bigint, p_currency text, p_rate numeric)
returns bigint
language sql immutable set search_path = ''
as $$
  select round(p_amount * (case when coalesce(p_currency, 'IDR') = 'IDR' then 1 else coalesce(p_rate, 1) end)
               / (case when coalesce(p_currency, 'IDR') in ('IDR', 'JPY', 'KRW', 'VND') then 1 else 100 end))::bigint
$$;

drop function if exists public.push_rp(bigint);
create or replace function public.push_rp(p numeric)
returns text
language sql immutable set search_path = ''
as $$
  select 'Rp ' || replace(to_char(round(p), 'FM999,999,999,999,990'), ',', '.')
$$;

create or replace function public.queue_push_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_cat text;
begin
  if new.flag is not null or new.created_by is null then
    return new;
  end if;
  select visibility, currency, fx_rate into a from public.accounts where id = new.account_id;
  if a.visibility <> 'shared' then
    return new;
  end if;
  select name into v_cat from public.categories where id = new.category_id;
  insert into public.push_queue (dompet_id, member_id, kind, amount_idr, label)
  values (new.dompet_id, new.created_by, new.kind, public.push_idr(new.amount, a.currency, a.fx_rate),
          left(coalesce(nullif(trim(new.note), ''), v_cat, case new.kind when 'income' then 'Pemasukan' else 'Pengeluaran' end), 60));
  return new;
end $$;
revoke execute on function public.queue_push_entry() from public, anon, authenticated;
drop trigger if exists transactions_push_queue on public.transactions;
create trigger transactions_push_queue after insert on public.transactions
  for each row execute function public.queue_push_entry();

-- ---------------------------------------------------------------------------
-- What to send now
-- ---------------------------------------------------------------------------
create or replace function public.push_collect(p_now timestamptz default now())
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Jakarta';
  v_today date := v_local::date;
  v_hour int := extract(hour from v_local);
begin
  create temp table if not exists _push_out (user_id uuid, kind text, dedup text, title text, body text, url text, tag text) on commit drop;
  truncate _push_out;

  -- 1. Entries by other members (any time). Several by the same person are summed.
  with taken as (
    delete from public.push_queue q where q.created_at <= p_now returning q.*
  ), grouped as (
    select t.dompet_id, t.member_id, count(*) as n, sum(t.amount_idr) filter (where t.kind = 'expense') as out_idr,
           sum(t.amount_idr) filter (where t.kind = 'income') as in_idr, min(t.label) as label, min(t.kind) as kind
    from taken t where t.created_at > p_now - interval '6 hours'
    group by t.dompet_id, t.member_id
  )
  insert into _push_out
  select m.user_id, 'entries', null,
         coalesce(actor.display_name, 'Anggota') || ' mencatat ' ||
           case when g.n = 1 then case g.kind when 'income' then 'pemasukan' else 'pengeluaran' end else g.n || ' transaksi' end,
         case when g.n = 1 then g.label || ' · ' || public.push_rp(coalesce(g.out_idr, g.in_idr))
              else concat_ws(' · ', case when g.out_idr > 0 then 'keluar ' || public.push_rp(g.out_idr) end,
                                    case when g.in_idr > 0 then 'masuk ' || public.push_rp(g.in_idr) end) end
           || ' · ' || d.name,
         '/app#/riwayat', 'entry-' || g.dompet_id
  from grouped g
  join public.dompets d on d.id = g.dompet_id
  left join public.dompet_members actor on actor.id = g.member_id
  join public.dompet_members m on m.dompet_id = g.dompet_id and m.user_id is not null and m.id is distinct from g.member_id;

  -- Daily messages from 07:00.
  if v_hour >= 7 then
    -- 2. Rutin bills due today / tomorrow (shared accounts, or your own private one).
    insert into _push_out
    select m.user_id, 'bills', 'bill:' || r.id || ':' || r.next_date || ':' || m.user_id,
           case when r.next_date = v_today then 'Jatuh tempo hari ini: ' else 'Besok jatuh tempo: ' end || r.name,
           public.push_rp(public.push_idr(r.amount, a.currency, a.fx_rate)) || ' · ' ||
             case when r.kind = 'income' then 'pemasukan rutin' else 'ketuk untuk mencatat' end || ' · ' || d.name,
           '/app#/rutin', 'bill-' || r.id
    from public.recurring r
    join public.accounts a on a.id = r.account_id
    join public.dompets d on d.id = r.dompet_id
    join public.dompet_members m on m.dompet_id = r.dompet_id and m.user_id is not null
    where r.active and r.next_date between v_today and v_today + 1
      and (r.end_date is null or r.next_date <= r.end_date)
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 3. Loans due today / tomorrow.
    insert into _push_out
    select m.user_id, 'bills', 'loan:' || l.id || ':' || l.due_date || ':' || m.user_id,
           case when l.due_date = v_today then 'Hari ini: ' else 'Besok: ' end ||
             case l.direction when 'lent' then l.counterparty || ' janji bayar' else 'bayar utang ke ' || l.counterparty end,
           public.push_rp(public.push_idr(l.amount, a.currency, a.fx_rate)) || ' · ' || d.name,
           '/app#/pinjaman', 'loan-' || l.id
    from public.loans l
    join public.accounts a on a.id = l.account_id
    join public.dompets d on d.id = l.dompet_id
    join public.dompet_members m on m.dompet_id = l.dompet_id and m.user_id is not null
    where not l.settled and l.due_date between v_today and v_today + 1
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 4. Total monthly budget (no categories / member) at 80% and 100%, payday-aware.
    insert into _push_out
    select m.user_id, 'budget', 'budget:' || b.id || ':' || per.start || ':' || lvl.pct || ':' || m.user_id,
           case when lvl.pct = 100 then 'Anggaran ' || b.name || ' terlewati' else 'Anggaran ' || b.name || ' sudah 80%' end,
           'Terpakai ' || public.push_rp(sp.spent) || ' dari ' || public.push_rp(b.amount) || ' · ' ||
             case when sp.spent <= b.amount
                  then 'sisa ' || public.push_rp(b.amount - sp.spent) || ' untuk ' || (per.finish - v_today + 1) || ' hari'
                  else 'lewat ' || public.push_rp(sp.spent - b.amount) end || ' · ' || d.name,
           '/app#/anggaran', 'budget-' || b.id
    from public.budgets b
    join public.dompets d on d.id = b.dompet_id
    cross join lateral (
      select case when extract(day from v_today) >= d.period_start_day
                  then make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day)
                  else (make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day) - interval '1 month')::date
             end as start
    ) s0
    cross join lateral (select s0.start, (s0.start + interval '1 month' - interval '1 day')::date as finish) per
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)), 0)::bigint as spent
      from public.transactions t
      join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      left join public.categories c on c.id = t.category_id
      where t.dompet_id = b.dompet_id and t.kind = 'expense' and t.flag is null
        and t.date between per.start and least(per.finish, v_today)
        and not (coalesce(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids)
                 or coalesce(c.parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids))
    ) sp
    cross join lateral (
      select max(x) as pct from unnest(array[80, 100]) x where sp.spent * 100 >= b.amount * x
    ) lvl
    join public.dompet_members m on m.dompet_id = b.dompet_id and m.user_id is not null
    where b.period = 'monthly' and b.category_id is null and cardinality(b.category_ids) = 0 and b.member_id is null
      and lvl.pct is not null;

    -- 5. Sedompet plan ending in 7 days, tomorrow, or ended today (that person only).
    insert into _push_out
    select pa.user_id, 'plan', 'plan:' || pa.user_id || ':' || (pa.active_until at time zone 'Asia/Jakarta')::date || ':' || st.stage,
           case st.stage when 'end' then 'Langganan Sedompet berakhir hari ini'
                         when 'd1' then 'Langganan Sedompet berakhir besok'
                         else 'Langganan Sedompet berakhir 7 hari lagi' end,
           'Perpanjang supaya keluarga tetap bisa mencatat. Sisa masa aktif tidak hilang.',
           '/app', 'plan'
    from public.phone_access pa
    cross join lateral (
      select case (pa.active_until at time zone 'Asia/Jakarta')::date - v_today when 7 then 'd7' when 1 then 'd1' when 0 then 'end' end as stage
    ) st
    where pa.user_id is not null and pa.plan in ('bulanan', 'tahunan') and pa.active_until is not null and st.stage is not null;
  end if;

  -- 6. Monday weekly recap from 08:00 (last week's shared spending).
  if extract(isodow from v_local) = 1 and v_hour >= 8 then
    insert into _push_out
    select m.user_id, 'weekly', 'weekly:' || d.id || ':' || (v_today - 7) || ':' || m.user_id,
           'Rekap minggu lalu · ' || d.name,
           'Keluar ' || public.push_rp(w.last_week) ||
             case when w.week_before > 0 then ' (' || case when w.last_week > w.week_before then '▲ ' else '▼ ' end
                  || abs(round((w.last_week - w.week_before) * 100.0 / w.week_before)) || '%)' else '' end
             || '. Buka untuk lihat & bagikan ke grup.',
           '/app#/beranda', 'weekly-' || d.id
    from public.dompets d
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 7 and v_today - 1), 0)::bigint as last_week,
             coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 14 and v_today - 8), 0)::bigint as week_before
      from public.transactions t join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      where t.dompet_id = d.id and t.kind = 'expense' and t.flag is null and t.date between v_today - 14 and v_today - 1
    ) w
    join public.dompet_members m on m.dompet_id = d.id and m.user_id is not null
    where w.last_week > 0;
  end if;

  -- Each daily/weekly message once.
  delete from _push_out o where o.dedup is not null and exists (select 1 from public.push_sent s where s.key = o.dedup);
  insert into public.push_sent (key) select distinct o.dedup from _push_out o where o.dedup is not null on conflict do nothing;
  delete from public.push_sent where sent_at < p_now - interval '60 days';

  return query
  select s.endpoint, s.p256dh, s.auth, o.title, o.body, o.url, o.tag
  from _push_out o
  join public.push_subscriptions s on s.user_id = o.user_id and coalesce((s.prefs ->> o.kind)::boolean, true)
  join public.phone_access pa on pa.user_id = o.user_id and pa.activated;
end $$;

-- Called by the Edge Function for devices that are gone (HTTP 404/410).
create or replace function public.push_drop(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints)
$$;
create or replace function public.push_ok(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  update public.push_subscriptions set last_ok_at = now() where endpoint = any (p_endpoints)
$$;

revoke execute on function public.push_collect(timestamptz), public.push_drop(text[]), public.push_ok(text[]),
  public.push_idr(bigint, text, numeric), public.push_rp(numeric) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_collect(timestamptz), public.push_drop(text[]), public.push_ok(text[]) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261126000000_admin_activity.sql =====
-- Admin "Nomor terdaftar": real last activity + last transaction.
--
-- auth.users.last_sign_in_at only moves on a PIN login. Sessions persist for
-- weeks via refresh tokens, so for most people it stays at their sign-up
-- time. Supabase bumps auth.sessions.updated_at / refreshed_at on every token
-- refresh (about hourly while the app is open), so the newest of those is a
-- much better "last active" signal.
--
-- last_tx_at = newest transaction this person created (any Dompet), so the
-- admin can tell who is actually recording.

drop function if exists public.app_list_phones();
create function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint,
  plan text, active_until timestamptz,
  last_active_at timestamptz, last_tx_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id)),
         a.plan, a.active_until,
         greatest(
           u.last_sign_in_at,
           (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC'))
              from auth.sessions s where s.user_id = u.id)
         ),
         (select max(t.created_at)
            from public.transactions t
            join public.dompet_members m on m.id = t.created_by
           where u.id is not null and m.user_id = u.id)
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;
revoke execute on function public.app_list_phones() from public, anon;
grant execute on function public.app_list_phones() to authenticated;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261127000000_last_seen.sql =====
-- Admin "Terakhir buka": exact, app-reported last open.
--
-- 20261126 used auth.sessions refresh times, but Supabase only refreshes a
-- token when it is about to expire, so someone using the app right now could
-- still show "kemarin". The app now calls touch_last_seen() when it opens and
-- whenever it comes back to the foreground.

alter table public.phone_access add column if not exists last_seen_at timestamptz;

create or replace function public.touch_last_seen()
returns void
language sql volatile security definer set search_path = ''
as $$
  -- At most one write per minute per number.
  update public.phone_access a set last_seen_at = now()
  where a.phone = public.phone_from_email(auth.jwt() ->> 'email')
    and (a.last_seen_at is null or a.last_seen_at < now() - interval '1 minute');
$$;
revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

drop function if exists public.app_list_phones();
create function public.app_list_phones()
returns table (
  phone text, activated boolean, registered boolean, is_admin boolean, note text,
  activated_at timestamptz, last_sign_in_at timestamptz, dompets bigint,
  plan text, active_until timestamptz,
  last_active_at timestamptz, last_tx_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_app_admin();
  return query
  select a.phone, a.activated, u.id is not null, exists (select 1 from public.app_admins x where x.user_id = u.id),
         a.note, a.activated_at, u.last_sign_in_at,
         (select count(*) from public.dompet_members m where m.phone = a.phone or (u.id is not null and m.user_id = u.id)),
         a.plan, a.active_until,
         greatest(
           a.last_seen_at,
           u.last_sign_in_at,
           (select max(greatest(s.updated_at, s.refreshed_at at time zone 'UTC'))
              from auth.sessions s where s.user_id = u.id)
         ),
         (select max(t.created_at)
            from public.transactions t
            join public.dompet_members m on m.id = t.created_by
           where u.id is not null and m.user_id = u.id)
  from public.phone_access a
  left join auth.users u on u.email = a.phone || '@phone.sedompet.app'
  order by a.created_at desc;
end $$;
revoke execute on function public.app_list_phones() from public, anon;
grant execute on function public.app_list_phones() to authenticated;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261128000000_valas_saham.sql =====
-- Sedompet: multi-currency pockets (like BCA Valas) and IDX stock holdings.
--
-- * accounts.parent_id: a pocket holds several currencies. Its main account
--   is the parent; every other currency is a child account (one currency
--   each, so balances stay integer minor units). Deleting the main account
--   deletes its currencies.
-- * accounts.fx_auto: true = the app follows the live rate (fetched by every
--   device from /api/market); fx_rate stays as the manual rate / offline
--   fallback.
-- * holdings: stocks (IDX tickers) held in an account, as shares (1 lot =
--   100) and the average buy price in rupiah per share. Value = shares x the
--   live price, computed in the app. Same visibility as the account; any
--   member who can write (not viewers) may record buys and sells.

alter table public.accounts add column if not exists parent_id uuid references public.accounts (id) on delete cascade;
alter table public.accounts add column if not exists fx_auto boolean not null default true;
create index if not exists accounts_parent_idx on public.accounts (parent_id);

-- A currency belongs to a main account of the same Dompet (one level only).
create or replace function public.accounts_check_parent()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception 'account cannot be its own pocket'; end if;
  if not exists (
    select 1 from public.accounts p
    where p.id = new.parent_id and p.dompet_id = new.dompet_id and p.parent_id is null
  ) then
    raise exception 'pocket main account must be in the same Dompet and not itself a sub-currency';
  end if;
  return new;
end $$;

drop trigger if exists accounts_check_parent on public.accounts;
create trigger accounts_check_parent before insert or update of parent_id, dompet_id on public.accounts
  for each row execute function public.accounts_check_parent();

create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  account_id  uuid not null references public.accounts (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Z0-9]{2,6}$'),
  name        text check (char_length(name) <= 120),
  shares      bigint not null check (shares >= 0),
  avg_price   numeric not null default 0 check (avg_price >= 0),
  created_by  uuid references public.dompet_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, symbol)
);
create index if not exists holdings_dompet_idx on public.holdings (dompet_id);

alter table public.holdings enable row level security;

drop policy if exists holdings_select on public.holdings;
create policy holdings_select on public.holdings for select to authenticated
  using (public.is_dompet_member(dompet_id) and public.can_see_account(account_id));

drop policy if exists holdings_write on public.holdings;
create policy holdings_write on public.holdings for all to authenticated
  using (public.can_write_dompet(dompet_id) and public.can_see_account(account_id))
  with check (
    public.can_write_dompet(dompet_id)
    and exists (select 1 from public.accounts a where a.id = account_id and a.dompet_id = holdings.dompet_id)
    and public.can_see_account(account_id)
  );

revoke all on public.holdings from anon;
grant select, insert, update, delete on public.holdings to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.holdings;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261129000000_assets.sql =====
-- Sedompet: more investment types in holdings (crypto, gold, US stocks/ETFs).
--
-- * holdings.market: 'IDX' (Bursa Efek Indonesia, rupiah per share),
--   'US' (US stocks and ETFs, US dollars per share), 'CRYPTO' (rupiah per
--   coin), 'GOLD' (rupiah per gram; symbol is always 'EMAS').
-- * holdings.shares becomes numeric: crypto, gold grams and US fractional
--   shares are not whole numbers. For IDX it is still shares (1 lot = 100).
-- * avg_price is in the market's price currency (USD for 'US', else rupiah).

alter table public.holdings add column if not exists market text not null default 'IDX';
do $$ begin
  alter table public.holdings add constraint holdings_market_check check (market in ('IDX','US','CRYPTO','GOLD'));
exception when duplicate_object then null; end $$;

alter table public.holdings alter column shares type numeric using shares::numeric;

alter table public.holdings drop constraint if exists holdings_symbol_check;
do $$ begin
  alter table public.holdings add constraint holdings_symbol_check2 check (symbol ~ '^[A-Z0-9.-]{1,10}$');
exception when duplicate_object then null; end $$;

alter table public.holdings drop constraint if exists holdings_account_id_symbol_key;
do $$ begin
  alter table public.holdings add constraint holdings_account_market_symbol_key unique (account_id, market, symbol);
exception when duplicate_object or duplicate_table then null; end $$;

notify pgrst, 'reload schema';

-- ===== supabase/migrations/20261130000000_carry_reminder.sql =====
-- Sedompet: budget carry-over + "belum mencatat" push reminder.
--
-- * budgets.carry_from: when set, what a budget leaves unspent in a period
--   (day / week / month) is added to the next one, counting periods from this
--   date. NULL = off. The app does the maths; the server only stores it.
-- * push_collect(): new message kind 'reminder' (prefs key "reminder", on by
--   default): you recorded nothing for 24 hours. Sent 07:00-21:59 Jakarta,
--   once a day, for at most 7 quiet days. Tapping it opens the add form
--   (/app#/catat). Everything else is unchanged from 20261125_push.

alter table public.budgets add column if not exists carry_from date;
create index if not exists transactions_created_by_idx on public.transactions (created_by, created_at);

create or replace function public.push_collect(p_now timestamptz default now())
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Jakarta';
  v_today date := v_local::date;
  v_hour int := extract(hour from v_local);
begin
  create temp table if not exists _push_out (user_id uuid, kind text, dedup text, title text, body text, url text, tag text) on commit drop;
  truncate _push_out;

  -- 1. Entries by other members (any time). Several by the same person are summed.
  with taken as (
    delete from public.push_queue q where q.created_at <= p_now returning q.*
  ), grouped as (
    select t.dompet_id, t.member_id, count(*) as n, sum(t.amount_idr) filter (where t.kind = 'expense') as out_idr,
           sum(t.amount_idr) filter (where t.kind = 'income') as in_idr, min(t.label) as label, min(t.kind) as kind
    from taken t where t.created_at > p_now - interval '6 hours'
    group by t.dompet_id, t.member_id
  )
  insert into _push_out
  select m.user_id, 'entries', null,
         coalesce(actor.display_name, 'Anggota') || ' mencatat ' ||
           case when g.n = 1 then case g.kind when 'income' then 'pemasukan' else 'pengeluaran' end else g.n || ' transaksi' end,
         case when g.n = 1 then g.label || ' · ' || public.push_rp(coalesce(g.out_idr, g.in_idr))
              else concat_ws(' · ', case when g.out_idr > 0 then 'keluar ' || public.push_rp(g.out_idr) end,
                                    case when g.in_idr > 0 then 'masuk ' || public.push_rp(g.in_idr) end) end
           || ' · ' || d.name,
         '/app#/riwayat', 'entry-' || g.dompet_id
  from grouped g
  join public.dompets d on d.id = g.dompet_id
  left join public.dompet_members actor on actor.id = g.member_id
  join public.dompet_members m on m.dompet_id = g.dompet_id and m.user_id is not null and m.id is distinct from g.member_id;

  -- Daily messages from 07:00.
  if v_hour >= 7 then
    -- 2. Rutin bills due today / tomorrow (shared accounts, or your own private one).
    insert into _push_out
    select m.user_id, 'bills', 'bill:' || r.id || ':' || r.next_date || ':' || m.user_id,
           case when r.next_date = v_today then 'Jatuh tempo hari ini: ' else 'Besok jatuh tempo: ' end || r.name,
           public.push_rp(public.push_idr(r.amount, a.currency, a.fx_rate)) || ' · ' ||
             case when r.kind = 'income' then 'pemasukan rutin' else 'ketuk untuk mencatat' end || ' · ' || d.name,
           '/app#/rutin', 'bill-' || r.id
    from public.recurring r
    join public.accounts a on a.id = r.account_id
    join public.dompets d on d.id = r.dompet_id
    join public.dompet_members m on m.dompet_id = r.dompet_id and m.user_id is not null
    where r.active and r.next_date between v_today and v_today + 1
      and (r.end_date is null or r.next_date <= r.end_date)
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 3. Loans due today / tomorrow.
    insert into _push_out
    select m.user_id, 'bills', 'loan:' || l.id || ':' || l.due_date || ':' || m.user_id,
           case when l.due_date = v_today then 'Hari ini: ' else 'Besok: ' end ||
             case l.direction when 'lent' then l.counterparty || ' janji bayar' else 'bayar utang ke ' || l.counterparty end,
           public.push_rp(public.push_idr(l.amount, a.currency, a.fx_rate)) || ' · ' || d.name,
           '/app#/pinjaman', 'loan-' || l.id
    from public.loans l
    join public.accounts a on a.id = l.account_id
    join public.dompets d on d.id = l.dompet_id
    join public.dompet_members m on m.dompet_id = l.dompet_id and m.user_id is not null
    where not l.settled and l.due_date between v_today and v_today + 1
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 4. Total monthly budget (no categories / member) at 80% and 100%, payday-aware.
    insert into _push_out
    select m.user_id, 'budget', 'budget:' || b.id || ':' || per.start || ':' || lvl.pct || ':' || m.user_id,
           case when lvl.pct = 100 then 'Anggaran ' || b.name || ' terlewati' else 'Anggaran ' || b.name || ' sudah 80%' end,
           'Terpakai ' || public.push_rp(sp.spent) || ' dari ' || public.push_rp(b.amount) || ' · ' ||
             case when sp.spent <= b.amount
                  then 'sisa ' || public.push_rp(b.amount - sp.spent) || ' untuk ' || (per.finish - v_today + 1) || ' hari'
                  else 'lewat ' || public.push_rp(sp.spent - b.amount) end || ' · ' || d.name,
           '/app#/anggaran', 'budget-' || b.id
    from public.budgets b
    join public.dompets d on d.id = b.dompet_id
    cross join lateral (
      select case when extract(day from v_today) >= d.period_start_day
                  then make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day)
                  else (make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day) - interval '1 month')::date
             end as start
    ) s0
    cross join lateral (select s0.start, (s0.start + interval '1 month' - interval '1 day')::date as finish) per
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)), 0)::bigint as spent
      from public.transactions t
      join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      left join public.categories c on c.id = t.category_id
      where t.dompet_id = b.dompet_id and t.kind = 'expense' and t.flag is null
        and t.date between per.start and least(per.finish, v_today)
        and not (coalesce(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids)
                 or coalesce(c.parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids))
    ) sp
    cross join lateral (
      select max(x) as pct from unnest(array[80, 100]) x where sp.spent * 100 >= b.amount * x
    ) lvl
    join public.dompet_members m on m.dompet_id = b.dompet_id and m.user_id is not null
    where b.period = 'monthly' and b.category_id is null and cardinality(b.category_ids) = 0 and b.member_id is null
      and lvl.pct is not null;

    -- 5. Sedompet plan ending in 7 days, tomorrow, or ended today (that person only).
    insert into _push_out
    select pa.user_id, 'plan', 'plan:' || pa.user_id || ':' || (pa.active_until at time zone 'Asia/Jakarta')::date || ':' || st.stage,
           case st.stage when 'end' then 'Langganan Sedompet berakhir hari ini'
                         when 'd1' then 'Langganan Sedompet berakhir besok'
                         else 'Langganan Sedompet berakhir 7 hari lagi' end,
           'Perpanjang supaya keluarga tetap bisa mencatat. Sisa masa aktif tidak hilang.',
           '/app', 'plan'
    from public.phone_access pa
    cross join lateral (
      select case (pa.active_until at time zone 'Asia/Jakarta')::date - v_today when 7 then 'd7' when 1 then 'd1' when 0 then 'end' end as stage
    ) st
    where pa.user_id is not null and pa.plan in ('bulanan', 'tahunan') and pa.active_until is not null and st.stage is not null;
  end if;

  -- 6. Monday weekly recap from 08:00 (last week's shared spending).
  if extract(isodow from v_local) = 1 and v_hour >= 8 then
    insert into _push_out
    select m.user_id, 'weekly', 'weekly:' || d.id || ':' || (v_today - 7) || ':' || m.user_id,
           'Rekap minggu lalu · ' || d.name,
           'Keluar ' || public.push_rp(w.last_week) ||
             case when w.week_before > 0 then ' (' || case when w.last_week > w.week_before then '▲ ' else '▼ ' end
                  || abs(round((w.last_week - w.week_before) * 100.0 / w.week_before)) || '%)' else '' end
             || '. Buka untuk lihat & bagikan ke grup.',
           '/app#/beranda', 'weekly-' || d.id
    from public.dompets d
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 7 and v_today - 1), 0)::bigint as last_week,
             coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 14 and v_today - 8), 0)::bigint as week_before
      from public.transactions t join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      where t.dompet_id = d.id and t.kind = 'expense' and t.flag is null and t.date between v_today - 14 and v_today - 1
    ) w
    join public.dompet_members m on m.dompet_id = d.id and m.user_id is not null
    where w.last_week > 0;
  end if;

  -- 7. Reminder to record: nothing recorded by you (any Dompet) for 24 hours.
  -- 07:00-21:59 only, once a day, and only for the first 7 quiet days.
  if v_hour >= 7 and v_hour < 22 then
    insert into _push_out
    select u.user_id, 'reminder', 'idle:' || u.user_id || ':' || v_today,
           'Belum ada catatan hari ini',
           case when u.last_entry is null then 'Yuk catat pengeluaran pertamamu. Cukup 10 detik.'
                else 'Terakhir mencatat ' || to_char(u.last_entry at time zone 'Asia/Jakarta', 'DD/MM HH24:MI')
                     || '. Ada belanja yang belum dicatat?' end,
           '/app#/catat', 'reminder'
    from (
      select m.user_id,
             max(t.created_at) as last_entry,
             min(m.joined_at) as joined
      from public.dompet_members m
      left join public.transactions t on t.created_by = m.id
      where m.user_id is not null
      group by m.user_id
    ) u
    where coalesce(u.last_entry, u.joined) < p_now - interval '24 hours'
      and coalesce(u.last_entry, u.joined) > p_now - interval '8 days';
  end if;

  -- Each daily/weekly message once.
  delete from _push_out o where o.dedup is not null and exists (select 1 from public.push_sent s where s.key = o.dedup);
  insert into public.push_sent (key) select distinct o.dedup from _push_out o where o.dedup is not null on conflict do nothing;
  delete from public.push_sent where sent_at < p_now - interval '60 days';

  return query
  select s.endpoint, s.p256dh, s.auth, o.title, o.body, o.url, o.tag
  from _push_out o
  join public.push_subscriptions s on s.user_id = o.user_id and coalesce((s.prefs ->> o.kind)::boolean, true)
  join public.phone_access pa on pa.user_id = o.user_id and pa.activated;
end $$;

revoke execute on function public.push_collect(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_collect(timestamptz) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
