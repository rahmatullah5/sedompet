-- Sedompet: a budget can cover several categories (category_id stays for a single one).
alter table public.budgets add column if not exists category_ids uuid[] not null default '{}';
