-- Sedompet: budgets can be daily, weekly (Mon-Sun) or monthly.
alter table public.budgets add column if not exists period text not null default 'monthly';
do $$ begin
  alter table public.budgets add constraint budgets_period_check check (period in ('daily', 'weekly', 'monthly'));
exception when duplicate_object then null; end $$;
