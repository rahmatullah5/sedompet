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
