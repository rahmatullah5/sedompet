# Push notifications setup (one time)

The app and database rules are ready. These steps connect them to a sender
that runs every 5 minutes. Run them on your own machine / Supabase dashboard.

## 1. Database

Run `supabase/migrations/20261125000000_push.sql` in **Supabase → SQL Editor**
(or the whole `supabase/apply_all.sql`, safe to re-run).

## 2. Keys (VAPID)

```bash
npx web-push generate-vapid-keys
```

Keep the **private key** secret. Put the **public key** in the database so the app can read it:

```sql
insert into public.app_config (key, value) values ('vapid_public_key', '<PUBLIC KEY>')
on conflict (key) do update set value = excluded.value;
```

## 3. Edge Function `send-push`

Pick a random secret for the scheduler, e.g. `openssl rand -hex 24`.

With the Supabase CLI (from the `sedompet/` folder):

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set VAPID_PUBLIC_KEY=<PUBLIC KEY> VAPID_PRIVATE_KEY=<PRIVATE KEY> VAPID_SUBJECT=mailto:<your email> PUSH_CRON_SECRET=<RANDOM SECRET>
npx supabase functions deploy send-push --no-verify-jwt
```

(Or in the dashboard: Edge Functions → Deploy a new function named `send-push`
with `supabase/functions/send-push/index.ts`, turn off "Verify JWT", and add the
four secrets under Edge Functions → Secrets.)

## 4. Run it every 5 minutes

Dashboard → Database → Extensions: enable **pg_cron** and **pg_net**. Then in SQL Editor:

```sql
select cron.schedule(
  'sedompet-send-push',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
       headers := jsonb_build_object('Authorization', 'Bearer <RANDOM SECRET>', 'Content-Type', 'application/json'),
       body := '{}'::jsonb) $$
);
```

To stop: `select cron.unschedule('sedompet-send-push');`

## 5. Try it

1. Open https://sedompet.vercel.app/app → Menu → **Notifikasi** → *Aktifkan notifikasi*
   (iPhone: install to Home Screen first and open from the icon).
2. Have another member record an expense on a shared account.
3. Within 5 minutes you get "<name> mencatat pengeluaran …".

Manual run: `curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/send-push -H "Authorization: Bearer <RANDOM SECRET>"`
returns `{"messages":…,"sent":…,"removed":…,"failed":…}`.
