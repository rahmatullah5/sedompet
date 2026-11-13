-- Sedompet: web push notifications.
--
-- * push_subscriptions: one row per browser/device that allowed notifications,
--   with the person's choices (prefs). Managed through push_subscribe() etc.
-- * Shared-account entries are queued by a trigger (push_queue).
-- * push_collect() (service role only) decides what to send right now and
--   returns one row per (device, message). It remembers what was sent in
--   push_sent so daily/weekly messages go out once. The 'send-push' Edge
--   Function calls it every few minutes (see SETUP-PUSH.md) and delivers.
--
-- Messages: someone else recorded an entry, Rutin bill due today/tomorrow,
-- loan due today/tomorrow, total monthly budget at 80% / 100%, Monday weekly
-- recap, Sedompet plan ending in 7 days / 1 day / today.
-- Times are Asia/Jakarta.

-- ---------------------------------------------------------------------------
-- Config readable by the app (the VAPID public key)
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to authenticated;
drop policy if exists app_config_public on public.app_config;
create policy app_config_public on public.app_config for select to authenticated using (key in ('vapid_public_key'));

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://'),
  p256dh      text not null,
  auth        text not null,
  prefs       jsonb not null default '{"entries": true, "bills": true, "budget": true, "weekly": true, "plan": true}',
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- Register (or move to me) this browser's subscription.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_prefs jsonb default null, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, prefs, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth,
          coalesce(p_prefs, '{"entries": true, "bills": true, "budget": true, "weekly": true, "plan": true}'), left(p_user_agent, 200))
  on conflict (endpoint) do update set
    user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    prefs = coalesce(p_prefs, public.push_subscriptions.prefs), user_agent = excluded.user_agent;
end $$;

create or replace function public.push_set_prefs(p_endpoint text, p_prefs jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update public.push_subscriptions set prefs = p_prefs where endpoint = p_endpoint and user_id = auth.uid()
$$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

revoke execute on function public.push_subscribe(text, text, text, jsonb, text), public.push_set_prefs(text, jsonb), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, jsonb, text), public.push_set_prefs(text, jsonb), public.push_unsubscribe(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Queue of new shared entries ("Ibu mencatat ...")
-- ---------------------------------------------------------------------------
create table if not exists public.push_queue (
  id          bigserial primary key,
  dompet_id   uuid not null references public.dompets (id) on delete cascade,
  member_id   uuid references public.dompet_members (id) on delete cascade,
  kind        text not null,
  amount_idr  bigint not null,
  label       text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;

create table if not exists public.push_sent (
  key      text primary key,
  sent_at  timestamptz not null default now()
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- Rupiah value of an amount on an account (minor units for 2-decimal currencies).
create or replace function public.push_idr(p_amount bigint, p_currency text, p_rate numeric)
returns bigint
language sql immutable set search_path = ''
as $$
  select round(p_amount * (case when coalesce(p_currency, 'IDR') = 'IDR' then 1 else coalesce(p_rate, 1) end)
               / (case when coalesce(p_currency, 'IDR') in ('IDR', 'JPY', 'KRW', 'VND') then 1 else 100 end))::bigint
$$;

drop function if exists public.push_rp(bigint);
create or replace function public.push_rp(p numeric)
returns text
language sql immutable set search_path = ''
as $$
  select 'Rp ' || replace(to_char(round(p), 'FM999,999,999,999,990'), ',', '.')
$$;

create or replace function public.queue_push_entry()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_cat text;
begin
  if new.flag is not null or new.created_by is null then
    return new;
  end if;
  select visibility, currency, fx_rate into a from public.accounts where id = new.account_id;
  if a.visibility <> 'shared' then
    return new;
  end if;
  select name into v_cat from public.categories where id = new.category_id;
  insert into public.push_queue (dompet_id, member_id, kind, amount_idr, label)
  values (new.dompet_id, new.created_by, new.kind, public.push_idr(new.amount, a.currency, a.fx_rate),
          left(coalesce(nullif(trim(new.note), ''), v_cat, case new.kind when 'income' then 'Pemasukan' else 'Pengeluaran' end), 60));
  return new;
end $$;
revoke execute on function public.queue_push_entry() from public, anon, authenticated;
drop trigger if exists transactions_push_queue on public.transactions;
create trigger transactions_push_queue after insert on public.transactions
  for each row execute function public.queue_push_entry();

-- ---------------------------------------------------------------------------
-- What to send now
-- ---------------------------------------------------------------------------
create or replace function public.push_collect(p_now timestamptz default now())
returns table (endpoint text, p256dh text, auth text, title text, body text, url text, tag text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Jakarta';
  v_today date := v_local::date;
  v_hour int := extract(hour from v_local);
begin
  create temp table if not exists _push_out (user_id uuid, kind text, dedup text, title text, body text, url text, tag text) on commit drop;
  truncate _push_out;

  -- 1. Entries by other members (any time). Several by the same person are summed.
  with taken as (
    delete from public.push_queue q where q.created_at <= p_now returning q.*
  ), grouped as (
    select t.dompet_id, t.member_id, count(*) as n, sum(t.amount_idr) filter (where t.kind = 'expense') as out_idr,
           sum(t.amount_idr) filter (where t.kind = 'income') as in_idr, min(t.label) as label, min(t.kind) as kind
    from taken t where t.created_at > p_now - interval '6 hours'
    group by t.dompet_id, t.member_id
  )
  insert into _push_out
  select m.user_id, 'entries', null,
         coalesce(actor.display_name, 'Anggota') || ' mencatat ' ||
           case when g.n = 1 then case g.kind when 'income' then 'pemasukan' else 'pengeluaran' end else g.n || ' transaksi' end,
         case when g.n = 1 then g.label || ' · ' || public.push_rp(coalesce(g.out_idr, g.in_idr))
              else concat_ws(' · ', case when g.out_idr > 0 then 'keluar ' || public.push_rp(g.out_idr) end,
                                    case when g.in_idr > 0 then 'masuk ' || public.push_rp(g.in_idr) end) end
           || ' · ' || d.name,
         '/app#/riwayat', 'entry-' || g.dompet_id
  from grouped g
  join public.dompets d on d.id = g.dompet_id
  left join public.dompet_members actor on actor.id = g.member_id
  join public.dompet_members m on m.dompet_id = g.dompet_id and m.user_id is not null and m.id is distinct from g.member_id;

  -- Daily messages from 07:00.
  if v_hour >= 7 then
    -- 2. Rutin bills due today / tomorrow (shared accounts, or your own private one).
    insert into _push_out
    select m.user_id, 'bills', 'bill:' || r.id || ':' || r.next_date || ':' || m.user_id,
           case when r.next_date = v_today then 'Jatuh tempo hari ini: ' else 'Besok jatuh tempo: ' end || r.name,
           public.push_rp(public.push_idr(r.amount, a.currency, a.fx_rate)) || ' · ' ||
             case when r.kind = 'income' then 'pemasukan rutin' else 'ketuk untuk mencatat' end || ' · ' || d.name,
           '/app#/rutin', 'bill-' || r.id
    from public.recurring r
    join public.accounts a on a.id = r.account_id
    join public.dompets d on d.id = r.dompet_id
    join public.dompet_members m on m.dompet_id = r.dompet_id and m.user_id is not null
    where r.active and r.next_date between v_today and v_today + 1
      and (r.end_date is null or r.next_date <= r.end_date)
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 3. Loans due today / tomorrow.
    insert into _push_out
    select m.user_id, 'bills', 'loan:' || l.id || ':' || l.due_date || ':' || m.user_id,
           case when l.due_date = v_today then 'Hari ini: ' else 'Besok: ' end ||
             case l.direction when 'lent' then l.counterparty || ' janji bayar' else 'bayar utang ke ' || l.counterparty end,
           public.push_rp(public.push_idr(l.amount, a.currency, a.fx_rate)) || ' · ' || d.name,
           '/app#/pinjaman', 'loan-' || l.id
    from public.loans l
    join public.accounts a on a.id = l.account_id
    join public.dompets d on d.id = l.dompet_id
    join public.dompet_members m on m.dompet_id = l.dompet_id and m.user_id is not null
    where not l.settled and l.due_date between v_today and v_today + 1
      and (a.visibility = 'shared' or a.owner_member_id = m.id);

    -- 4. Total monthly budget (no categories / member) at 80% and 100%, payday-aware.
    insert into _push_out
    select m.user_id, 'budget', 'budget:' || b.id || ':' || per.start || ':' || lvl.pct || ':' || m.user_id,
           case when lvl.pct = 100 then 'Anggaran ' || b.name || ' terlewati' else 'Anggaran ' || b.name || ' sudah 80%' end,
           'Terpakai ' || public.push_rp(sp.spent) || ' dari ' || public.push_rp(b.amount) || ' · ' ||
             case when sp.spent <= b.amount
                  then 'sisa ' || public.push_rp(b.amount - sp.spent) || ' untuk ' || (per.finish - v_today + 1) || ' hari'
                  else 'lewat ' || public.push_rp(sp.spent - b.amount) end || ' · ' || d.name,
           '/app#/anggaran', 'budget-' || b.id
    from public.budgets b
    join public.dompets d on d.id = b.dompet_id
    cross join lateral (
      select case when extract(day from v_today) >= d.period_start_day
                  then make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day)
                  else (make_date(extract(year from v_today)::int, extract(month from v_today)::int, d.period_start_day) - interval '1 month')::date
             end as start
    ) s0
    cross join lateral (select s0.start, (s0.start + interval '1 month' - interval '1 day')::date as finish) per
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)), 0)::bigint as spent
      from public.transactions t
      join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      left join public.categories c on c.id = t.category_id
      where t.dompet_id = b.dompet_id and t.kind = 'expense' and t.flag is null
        and t.date between per.start and least(per.finish, v_today)
        and not (coalesce(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids)
                 or coalesce(c.parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = any (b.exclude_category_ids))
    ) sp
    cross join lateral (
      select max(x) as pct from unnest(array[80, 100]) x where sp.spent * 100 >= b.amount * x
    ) lvl
    join public.dompet_members m on m.dompet_id = b.dompet_id and m.user_id is not null
    where b.period = 'monthly' and b.category_id is null and cardinality(b.category_ids) = 0 and b.member_id is null
      and lvl.pct is not null;

    -- 5. Sedompet plan ending in 7 days, tomorrow, or ended today (that person only).
    insert into _push_out
    select pa.user_id, 'plan', 'plan:' || pa.user_id || ':' || (pa.active_until at time zone 'Asia/Jakarta')::date || ':' || st.stage,
           case st.stage when 'end' then 'Langganan Sedompet berakhir hari ini'
                         when 'd1' then 'Langganan Sedompet berakhir besok'
                         else 'Langganan Sedompet berakhir 7 hari lagi' end,
           'Perpanjang supaya keluarga tetap bisa mencatat. Sisa masa aktif tidak hilang.',
           '/app', 'plan'
    from public.phone_access pa
    cross join lateral (
      select case (pa.active_until at time zone 'Asia/Jakarta')::date - v_today when 7 then 'd7' when 1 then 'd1' when 0 then 'end' end as stage
    ) st
    where pa.user_id is not null and pa.plan in ('bulanan', 'tahunan') and pa.active_until is not null and st.stage is not null;
  end if;

  -- 6. Monday weekly recap from 08:00 (last week's shared spending).
  if extract(isodow from v_local) = 1 and v_hour >= 8 then
    insert into _push_out
    select m.user_id, 'weekly', 'weekly:' || d.id || ':' || (v_today - 7) || ':' || m.user_id,
           'Rekap minggu lalu · ' || d.name,
           'Keluar ' || public.push_rp(w.last_week) ||
             case when w.week_before > 0 then ' (' || case when w.last_week > w.week_before then '▲ ' else '▼ ' end
                  || abs(round((w.last_week - w.week_before) * 100.0 / w.week_before)) || '%)' else '' end
             || '. Buka untuk lihat & bagikan ke grup.',
           '/app#/beranda', 'weekly-' || d.id
    from public.dompets d
    cross join lateral (
      select coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 7 and v_today - 1), 0)::bigint as last_week,
             coalesce(sum(public.push_idr(t.amount, a.currency, a.fx_rate)) filter (where t.date between v_today - 14 and v_today - 8), 0)::bigint as week_before
      from public.transactions t join public.accounts a on a.id = t.account_id and a.visibility = 'shared'
      where t.dompet_id = d.id and t.kind = 'expense' and t.flag is null and t.date between v_today - 14 and v_today - 1
    ) w
    join public.dompet_members m on m.dompet_id = d.id and m.user_id is not null
    where w.last_week > 0;
  end if;

  -- Each daily/weekly message once.
  delete from _push_out o where o.dedup is not null and exists (select 1 from public.push_sent s where s.key = o.dedup);
  insert into public.push_sent (key) select distinct o.dedup from _push_out o where o.dedup is not null on conflict do nothing;
  delete from public.push_sent where sent_at < p_now - interval '60 days';

  return query
  select s.endpoint, s.p256dh, s.auth, o.title, o.body, o.url, o.tag
  from _push_out o
  join public.push_subscriptions s on s.user_id = o.user_id and coalesce((s.prefs ->> o.kind)::boolean, true)
  join public.phone_access pa on pa.user_id = o.user_id and pa.activated;
end $$;

-- Called by the Edge Function for devices that are gone (HTTP 404/410).
create or replace function public.push_drop(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = any (p_endpoints)
$$;
create or replace function public.push_ok(p_endpoints text[])
returns void
language sql security definer set search_path = ''
as $$
  update public.push_subscriptions set last_ok_at = now() where endpoint = any (p_endpoints)
$$;

revoke execute on function public.push_collect(timestamptz), public.push_drop(text[]), public.push_ok(text[]),
  public.push_idr(bigint, text, numeric), public.push_rp(numeric) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_collect(timestamptz), public.push_drop(text[]), public.push_ok(text[]) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
