-- Sedompet: savings goals ("Tabungan tujuan").
--
-- A goal has a target in rupiah and optionally a target date. Progress comes
-- from a linked account's balance when account_id is set, otherwise from
-- `saved`, which members top up by hand ("Setor" / "Ambil").
--   * Everyone in the Dompet sees goals, except a goal linked to a private
--     account, which only that account's owner sees.
--   * Owner/admin create, edit and delete goals; members may update them
--     (the app only lets members change `saved`).

create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  dompet_id    uuid not null references public.dompets (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  icon         text not null default '🎯' check (char_length(icon) <= 60000),
  target       bigint not null check (target > 0),
  target_date  date,
  account_id   uuid references public.accounts (id) on delete set null,
  saved        bigint not null default 0,
  created_by   uuid references public.dompet_members (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists goals_dompet_idx on public.goals (dompet_id);

alter table public.goals enable row level security;

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (public.is_dompet_member(dompet_id) and (account_id is null or public.can_see_account(account_id)));

drop policy if exists goals_admin on public.goals;
create policy goals_admin on public.goals for all to authenticated
  using (public.can_admin_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)))
  with check (
    public.can_admin_dompet(dompet_id)
    and (account_id is null or exists (
      select 1 from public.accounts a where a.id = account_id and a.dompet_id = goals.dompet_id
    ) and public.can_see_account(account_id))
  );

drop policy if exists goals_member_update on public.goals;
create policy goals_member_update on public.goals for update to authenticated
  using (public.can_write_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)))
  with check (public.can_write_dompet(dompet_id) and (account_id is null or public.can_see_account(account_id)));

revoke all on public.goals from anon;
grant select, insert, update, delete on public.goals to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.goals;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
