# Sedompet — From Personal Cashew to Shared Family Wallet

> "Sedompet" (Bahasa Indonesia: *satu dompet*, "one wallet"): one family or friend group shares one wallet: the same accounts, categories, budgets and transactions, from phone or browser.

## 1. What the code is today

| Area | Current state (Cashew fork) | Where |
|---|---|---|
| Stack | Flutter app, `budget/` package, ~212 Dart files | `budget/pubspec.yaml` |
| Storage | **Local-first** SQLite via Drift, schema v46, 11 tables | `budget/lib/database/tables.dart` (7.6k lines) |
| Web | **Already builds for web.** It uses the legacy `drift/web.dart` (sql.js + IndexedDB) and Firebase Hosting | `budget/web/`, `budget/lib/database/platform/web.dart`, `budget/firebase.json` |
| Multi-device sync | Each device uploads its **whole SQLite file** (`sync-<clientID>.sqlite`) to the **user's own Google Drive**. Other devices download it and merge rows by `dateTimeModified` plus `DeleteLogs`. | `budget/lib/struct/syncClient.dart` |
| Identity | Google Sign-In only, one Google account, used for Drive scope | `budget/lib/widgets/accountAndBackup.dart`, `budget/lib/struct/firebaseAuthGlobal.dart` |
| Sharing | Old **Shared Budgets** feature in Firestore (`budgets` collection, `sharedKey`, `sharedMembers`, `transactionOwnerEmail`). It is off by default (`"sharedBudgets": false`) and only shares *one budget's transactions*, not the whole wallet. | `budget/lib/struct/shareBudget.dart`, `budget/lib/struct/defaultPreferences.dart:178` |
| Settings | Everything lives in one `AppSettings` JSON blob, so personal settings (theme) and data settings (categories order, home widgets) are mixed together | `budget/lib/struct/settings.dart` |
| Firebase project | Still the original author's (`budget-app-flutter`, hosting site `budget-track`) | `budget/lib/firebase_options.dart`, `budget/firebase.json` |
| License | **GPL-3.0**. A fork is allowed, but Sedompet must stay GPL-3.0, publish its source and keep attribution to Cashew | `LICENSE` |

### Why Cashew can't be "one wallet for a family"
1. **Data ownership is per-device and per-person.** There is no server-side source of truth. Sync is "my devices, my Google Drive".
2. **There are no user or member concepts in the schema.** Rows have no `owner`, `created_by` or `household` field.
3. **Sync merges whole DB files.** Two people editing at once means pulling full files from different Drives, and there are no permissions.
4. **Shared Budgets is a half-feature.** It covers only budgets and is disabled.

## 2. Target concept

```
User ──(member of, role)──▶ Dompet (household / group)
                               ├── Accounts   (Cashew "Wallets": Cash, BCA, GoPay…)
                               ├── Categories / Subcategories
                               ├── Transactions  (+ created_by, paid_by)
                               ├── Budgets / Category limits
                               ├── Objectives (goals) / Loans
                               └── Dompet settings (currency, category order)
User settings stay personal: theme, language, biometrics, notifications.
```

- A user can belong to **several Dompets** (Family, Kos-kosan, Trip Bali) and switch between them, like Slack workspaces.
- **Roles:** `owner` (billing, delete Dompet), `admin` (manage members and categories), `member` (add and edit own transactions), `viewer` (read-only, e.g. kids).
- **Invite** by link, QR code or 6-digit code. New members can sign in with Google **or email OTP**, because not every family member uses Google.
- **Naming:** "Dompet" means the shared space, so Cashew's "Wallet" is renamed to **"Rekening/Akun" (Account)** in the UI to avoid confusion.
- **Family features unlocked by membership:**
  - "Paid by" and "Added by" on each transaction, with a filter "Pengeluaran Ayah / Ibu / Kakak".
  - Per-member spending breakdown chart.
  - Optional **private accounts** (only visible to their owner, but counted in the totals the owner chooses).
  - Split bills / "who owes whom" for friend groups. This reuses Cashew's existing Loans (`Objectives` type loan).
  - Activity feed: "Ibu added Rp 150.000 Belanja Sayur".
  - Allowance (uang saku) budgets assigned to a member.

## 3. Architecture choice

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Supabase (Postgres + RLS) + PowerSync** ⭐ | Postgres is the source of truth. PowerSync streams each Dompet's rows into a local SQLite, and Drift keeps running on top (`drift_sqlite_async`). Works on Android, iOS and **web** (wa-sqlite / OPFS). | Keeps most Drift queries and UI; works offline; row-level security per `dompet_id`; SQL-native; easy to self-host | Two services; needs a migration from legacy `drift/web.dart` to the new web backend |
| B. Firestore as source of truth | Rewrite the data layer to Firestore collections `dompets/{id}/transactions…` with offline persistence | Firebase is already a dependency; realtime | Rewrites ~7.6k lines of SQL queries (totals, budgets, heatmaps); expensive per-read pricing at scale; weak aggregation |
| C. Shared Google Drive folder | Point everyone's sync at one shared Drive folder | Least code | Whole-file merges, race conditions, no roles, Google-only. **Not recommended.** |

**Recommendation: A.** Cashew's value is its large set of Drift SQL queries. PowerSync lets the app keep them and adds server sync and multi-user support underneath.

## 4. Schema changes (Drift v47 + Postgres)

New tables:
```sql
dompets(id uuid pk, name, currency, icon, colour, created_by, created_at)
dompet_members(dompet_id, user_id, role, display_name, colour, joined_at, pk(dompet_id,user_id))
dompet_invites(code pk, dompet_id, role, created_by, expires_at, max_uses, uses)
profiles(user_id pk, display_name, avatar_url)
```
Add to **every** data table (`wallets, transactions, categories, category_budget_limits, associated_titles, budgets, objectives, scanner_templates, delete_logs`):
```
dompet_id   TEXT NOT NULL   -- partition key for sync + RLS
created_by  TEXT            -- user id
updated_by  TEXT
```
Transactions also get `paid_by TEXT` (member user id). Wallets/accounts get `visibility ('shared'|'private')` and `owner_user_id`.

Remove or deprecate: `sharedKey`, `sharedOwnerMember`, `sharedMembers`, `sharedDateUpdated`, `transactionOwnerEmail`, `sharedReferenceBudgetPk`, the Firestore `shareBudget.dart`, and Drive file-sync `syncClient.dart`. Keep Drive **backup/export** as a personal feature.

RLS example:
```sql
create policy member_rw on transactions
  using (dompet_id in (select dompet_id from dompet_members where user_id = auth.uid()))
  with check (dompet_id in (select dompet_id from dompet_members
                            where user_id = auth.uid() and role in ('owner','admin','member')));
```
PowerSync sync rule: `bucket_definitions: by_dompet: parameters: select dompet_id from dompet_members where user_id = token_parameters.user_id`.

Every Drift query in `tables.dart` gets a `dompet_id = currentDompetId` filter. This is best done in one helper so it can't be forgotten.

## 5. Migration path for existing Cashew users
On first launch after the update:
1. The user signs in, and a personal Dompet "Dompet Saya" is created.
2. Existing local rows are backfilled with that `dompet_id` and `created_by = me`, then uploaded.
3. The user can then invite family. Merging two people's existing Cashew data into one Dompet uses the existing CSV/backup import, retargeted to a chosen Dompet.

## 6. Web
The app already builds for web. To make it production-ready:
- Replace legacy `drift/web.dart` (sql.js, whole DB rewritten to IndexedDB on every change) with PowerSync web SQLite, or with `drift/wasm.dart` (OPFS) if staying on plain Drift.
- Create **your own** Firebase/Supabase project, OAuth client IDs, and hosting site. Replace `firebase_options.dart`, `firebase.json` site `budget-track`, and `web/index.html` meta tags.
- Drop the deprecated `--web-renderer` flag in `firebase.json` predeploy for current Flutter.
- Make it an installable PWA: `web/manifest.json` with Sedompet name, icons and `theme_color`.
- Use a desktop layout (Cashew already has a wide-screen nav rail) and keyboard shortcuts (`keyboardIntents.dart`).
- Host on Vercel, Firebase Hosting or Cloudflare Pages.

## 7. Rebrand checklist
- App name, package IDs (`com.budget.tracker_app` → e.g. `id.sedompet.app`), icons, splash screen and store text.
- README credits: "Based on Cashew by James Kokoska (GPL-3.0)".
- Default locale and currency: `id` / `IDR`, and Indonesian default categories (Makan, Transport, Listrik/PLN, Pulsa & Data, Arisan, Zakat/Sedekah, Sekolah Anak).
- Strip Cashew-specific links (beta testing, donate, cashewapp.web.app).

## 8. Phased roadmap
| Phase | Scope | Size |
|---|---|---|
| 0 | Rebrand, own Firebase/Supabase project, CI builds web + Android | S |
| 1 | Auth (Google + email OTP), `dompets` / `members` / `invites`, Dompet switcher UI | M |
| 2 | Schema v47: add `dompet_id`/`created_by`/`paid_by`, scope all queries, PowerSync wiring, backfill migration | **L** (core risk) |
| 3 | Replace Drive sync and Shared Budgets; web DB on wa-sqlite/OPFS; PWA | M |
| 4 | Family features: paid-by filters, member charts, activity feed, private accounts, roles enforcement in UI | M |
| 5 | Split bills/settle-up, allowance budgets, push notifications on new family expenses | M |

## 9. Risks
- **Query scoping bugs** could leak one Dompet's data into another view. Mitigate with RLS on the server (hard guarantee) and a single scoped-query helper on the client.
- **Conflict handling:** PowerSync is last-write-wins per row. That is acceptable for transactions, but balances must stay *derived* (never stored).
- **GPL-3.0 obligations:** the source of Sedompet must be published.
- **No Flutter toolchain** was found on this machine (`flutter` not on PATH), so nothing was built or run during this review.
