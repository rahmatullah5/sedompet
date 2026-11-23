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
