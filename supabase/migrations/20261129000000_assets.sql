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
