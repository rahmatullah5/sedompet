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
