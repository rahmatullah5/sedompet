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
