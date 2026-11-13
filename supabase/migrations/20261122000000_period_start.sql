-- Sedompet: a Dompet's budget month can start on payday (1-28) instead of the 1st.
-- Budgets, reports and "sisa per hari" use this period. Owners/admins change
-- it in the app (same rule as renaming the Dompet).
alter table public.dompets add column if not exists period_start_day smallint not null default 1;
do $$ begin
  alter table public.dompets add constraint dompets_period_start_day_check check (period_start_day between 1 and 28);
exception when duplicate_object then null; end $$;
grant update (period_start_day) on public.dompets to authenticated;

-- Make the Supabase API pick up new/changed functions and columns right away.
notify pgrst, 'reload schema';
