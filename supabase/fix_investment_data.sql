-- Data fix for Recompound / Pluang (2026-11-23). Changes 6 rows, deletes nothing.
-- Run once in Supabase SQL Editor.
begin;

-- 1) Average prices typed per lembar into the "per lot" field (stored 100x too low).
--    LPPF 17,23 -> 1.723 · ISSP 4,38 -> 438 · ADRO 20,09 -> 2.009
update public.holdings set avg_price = avg_price * 100, updated_at = now()
where id in (
  '69a64227-badb-48a6-853f-9ecef27bc3eb',  -- LPPF 5200 lembar
  '3f958aa5-bb1e-408e-9454-bdbe2262ed36',  -- ISSP 19700 lembar
  'a25dd18d-8750-4b97-a504-ff2087715e85'   -- ADRO 5400 lembar
) and avg_price < 100;

-- 2) The cash -> holdings switch on 23 Nov: same amounts, but labelled as a move
--    into investments so Arus kas no longer shows it as a balance correction.
update public.transactions set note = 'Pindah ke investasi', updated_at = now()
where id in (
  'defd6aac-bdb6-4036-bf7b-c595d95b64d3',  -- Recompound -147.515.763
  'c40d078b-9d23-4588-b648-637191b46e8d',  -- Recompound -148.936.481
  '68472923-f3e0-4bd5-8f56-02c096ee89b3'   -- Pluang     -218.443.973
) and flag = 'adjustment' and note = 'Koreksi saldo';

-- Expect: 3 holdings and 3 transactions.
select 'holding' as what, symbol as item, avg_price::text as value from public.holdings
where id in ('69a64227-badb-48a6-853f-9ecef27bc3eb','3f958aa5-bb1e-408e-9454-bdbe2262ed36','a25dd18d-8750-4b97-a504-ff2087715e85')
union all
select 'transaction', note, amount::text from public.transactions
where id in ('defd6aac-bdb6-4036-bf7b-c595d95b64d3','c40d078b-9d23-4588-b648-637191b46e8d','68472923-f3e0-4bd5-8f56-02c096ee89b3');

commit;
