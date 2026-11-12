# Sedompet Web (demo)

> One wallet for the whole family. A web demo with no server: the data is SQLite inside the browser.

## Run

```bash
cd web && npm install
```
```bash
cd web && npm run dev
```
Then open http://localhost:5173.

Build static files with `npm run build`. The output goes to `dist/`, which you can host on Vercel, Netlify, Cloudflare Pages or Firebase Hosting.

## How it works
- **Database:** [sql.js](https://sql.js.org) (SQLite compiled to WebAssembly) runs in the browser. After each change, the database file is saved to IndexedDB.
- **Schema:** [src/db/schema.ts](src/db/schema.ts). Every table has a `dompet_id`, and transactions record `paid_by` and `created_by`. This is the same shape the Supabase schema will use later.
- **Roles:** the rules in [src/lib/permissions.ts](src/lib/permissions.ts) match the Postgres rules in `../supabase/migrations`:
  - owner: everything
  - admin: manage members, accounts and budgets
  - member: record transactions, edit only their own
  - viewer: read only
- **Private accounts (🔒):** only the owner sees the account and its transactions. Budgets count shared accounts only.
- **"Live" sharing between tabs:** a `BroadcastChannel` reloads the other open tabs. Each tab asks "Siapa yang lagi pakai?" ("Who's using this?"), so two tabs can act as two family members.
- **Data tools:** on the Keluarga page you can export or import the `.sqlite` file, or reset everything.

## Demo script
1. Click **Lihat demo keluarga**, then pick **Ayah**.
2. Open a second tab or window and pick **Ibu**. Record an expense with the **+** button. Ayah's tab updates straight away, including the chat-style "Kabar keluarga" feed.
3. In another tab, pick **Adik** (viewer). The **+** button is locked.
4. Pick **Kakak** and open one of Ibu's transactions. It's read-only for Kakak.
5. Only Ayah sees **Tabungan Ayah** 🔒.

## Cloud mode (Supabase), so family members share data across devices
**Login is phone number + a 6-digit PIN.** No SMS is sent. Instead, the admin (you) activates each number in the database first. Behind the scenes, Supabase Auth stores the number as `628…@phone.sedompet.app`, an address that never receives email.

### One-time setup
1. **SQL Editor:** run [`../supabase/apply_all.sql`](../supabase/apply_all.sql). It is safe to re-run. If you already ran an older copy, run only [`20261113000000_phone_login.sql`](../supabase/migrations/20261113000000_phone_login.sql).
2. **Authentication → Sign In / Providers → Email:** turn **Confirm email OFF**, and keep "Allow new users to sign up" ON.
3. **Authentication → Hooks → Before User Created:** choose the Postgres function `public.hook_before_user_created`. This blocks sign-ups for numbers you haven't activated.
4. Put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `web/.env.local` (already done), then run `npm run dev`.

### Activating family members (SQL Editor)
```sql
-- allow a number to sign up
select admin_activate_phone('0812xxxxxxxx');
-- or allow it AND add it straight into a Dompet (no invite code needed)
select admin_activate_phone('0812xxxxxxxx', '<dompet id>', 'member', 'Ibu');   -- roles: admin, member, viewer
-- block a number (loses access immediately)
select admin_deactivate_phone('0812xxxxxxxx');
```
After activation, the person opens the site, taps **Daftar pertama kali**, enters their number and chooses a PIN. Invite codes from the Keluarga page still work for activated numbers.

### Starting from a Cashew backup
```bash
python3 -I ../supabase/tools/cashew_to_seed.py BACKUP.sql 0812xxxxxxxx --dompet "Dompet Keluarga" --name "Ayah" -o ../supabase/seed_private/seed.sql
```
Run the generated file in the SQL Editor. It activates the number and creates the Dompet, which that number owns after its first login. `supabase/seed_private/` is gitignored because it contains personal finance data.

**How sync works:** the local SQLite database is a fast cache.
- **Saving:** triggers record each change in an `outbox` table, and the uploader sends it to Supabase. Postgres row-level security decides what's allowed.
- **Rejected changes:** if the server says no, the local copy is reloaded from the server.
- **Live updates:** realtime events from other family members trigger a fresh pull.
- **Code:** [src/cloud/sync.ts](src/cloud/sync.ts).

**Switching modes:** without the env variables, or after choosing "demo offline", the app runs fully offline (the demo above).

## Features
- **Accounts** with your own icon (emoji or uploaded image), private 🔒 accounts, and ⚖️ **balance correction**
- **Categories and subcategories** with custom icons
- **Recurring items:** subscriptions, bills, school fees (SPP), salary. Due items appear on Beranda with Bayar / Terima / Lewati buttons.
- **Loans:** utang (money you borrowed) and piutang (money you lent), with repayments
- **Budgets:** for one category, for all spending except chosen categories, or as an allowance for one member
- **Laporan:** spending pace against last month, income vs expense over 6 months, a category breakdown, and a forecast for month-end and the next 3 months
- **Import from Cashew:** Menu → Data. It runs in the browser; transfers and balance corrections don't count as spending.
