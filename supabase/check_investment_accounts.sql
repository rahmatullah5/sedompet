-- Read-only: shows everything that makes up the Recompound and Pluang balances,
-- so the wrong corrections can be found. Changes nothing.
-- Run in Supabase SQL Editor and send the result back.
with acc as (
  select id, name, currency, opening_balance, created_at
  from public.accounts
  where name in ('Recompound', 'Pluang')
)
select a.name as akun, '1 saldo awal' as jenis, a.created_at::date as tanggal,
       a.opening_balance as jumlah, a.currency as catatan, null::uuid as id
from acc a
union all
select a.name, '2 transaksi', t.date,
       case t.kind when 'income' then t.amount else -t.amount end,
       coalesce(t.flag, 'biasa') || ' · ' || t.note || ' · dibuat ' || to_char(t.created_at, 'DD Mon HH24:MI'),
       t.id
from acc a join public.transactions t on t.account_id = a.id
union all
select a.name, '3 investasi', h.created_at::date,
       round(h.shares * h.avg_price)::bigint,
       h.market || ' ' || h.symbol || ' · ' || h.shares || ' unit · rata² ' || h.avg_price,
       h.id
from acc a join public.holdings h on h.account_id = a.id
order by 1, 2, 3;
