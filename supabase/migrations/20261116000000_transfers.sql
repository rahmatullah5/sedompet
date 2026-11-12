-- Sedompet: link the two sides of a transfer (and its optional admin fee).
--
-- A transfer is stored as two transactions with flag = 'transfer' (an expense
-- from the source account, an income into the destination) plus, optionally,
-- a normal expense for the bank's admin fee. All share one transfer_id so the
-- app can edit or delete them together. Existing RLS applies to each row.

alter table public.transactions add column if not exists transfer_id uuid;
create index if not exists transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
