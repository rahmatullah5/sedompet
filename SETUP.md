# Sedompet setup (phase 0 + 1)

Phases 0 and 1 cover sign-in, shared Dompets, members, roles and invite codes. Shared finance data (scoping every account, transaction and budget to a `dompet_id` and syncing it with PowerSync) is phase 2. See [SEDOMPET_PLAN.md](SEDOMPET_PLAN.md).

If no backend is configured, the app runs exactly like Cashew (local only) and the **Dompet** page says sharing isn't set up.

## 1. Supabase

1. Create a project at supabase.com. Region: Singapore (`ap-southeast-1`) is closest to Indonesia.
2. Apply the migration in one of two ways:
   - Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`
   - or paste `supabase/migrations/20261112000000_dompet_core.sql` into the SQL editor and run it.
3. **Auth > Providers > Email**: keep it enabled. The app signs in with a 6-digit code, not a magic link, so edit **Auth > Email Templates > Magic Link** to show the code:
   ```html
   <h2>Kode masuk Sedompet</h2>
   <p>Kode kamu: <strong>{{ .Token }}</strong></p>
   ```
   Set up custom SMTP (Resend, Postmark, etc.) before going live. Supabase's built-in mailer is heavily rate-limited.
4. **Auth > Providers > Google** (optional):
   - In Google Cloud Console, create OAuth clients: **Web** (required), **iOS**, and **Android** (package name + SHA-1).
   - In Supabase, enter the Web client ID and secret. Add the iOS and Android client IDs under *Authorized Client IDs*.
   - If iOS sign-in fails with a nonce error, enable **Skip nonce check**.
5. **Auth > URL Configuration**: add your web origins (e.g. `https://sedompet.web.app`, `http://localhost:5000`) to *Redirect URLs*. Google sign-in on web returns to `Uri.base.origin`.

### Test the SQL locally (no Docker needed)
```bash
supabase/tests/run_local.sh
```
This starts a throwaway Postgres with a stubbed `auth` schema, applies the migrations twice to prove they can be re-run, and walks through owner/admin/member/viewer/stranger scenarios. Lines expected to fail are labelled in the output.

## 2. App config

```bash
cp sedompet.env.example.json sedompet.env.json
```
Fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` (anon or publishable key; **never** the service-role key), and the Google client IDs. `sedompet.env.json` is gitignored.

Then run the app:
```bash
cd budget && flutter pub get
```
```bash
cd budget && flutter run -d chrome --dart-define-from-file=../sedompet.env.json
```
On mobile, use the same `--dart-define-from-file` flag with `flutter run -d <device>`.

## 3. Web hosting

- `budget/firebase.json` now uses placeholder `YOUR_FIREBASE_HOSTING_SITE`. Create your own Firebase project and run `flutterfire configure` to regenerate `budget/lib/firebase_options.dart`, which still points at the original Cashew project (`budget-app-flutter`).
- `budget/web/index.html` has placeholder `YOUR_GOOGLE_WEB_CLIENT_ID`. It is only used by the legacy Google Drive backup on web.
- Deploy:
  ```bash
  cd budget && firebase deploy --only hosting
  ```
  Any static host (Vercel, Cloudflare Pages) also works with `flutter build web` output in `budget/build/web` and an SPA rewrite to `index.html`.

## 4. PowerSync (prepared, wired in phase 2)

- Create a PowerSync instance, connect it to the Supabase Postgres, and enable Supabase JWT auth.
- The migration already creates the `powersync` publication.
- Paste `supabase/powersync/sync-rules.yaml` into the instance's sync rules.

## What's still to do
- **Android/iOS identifiers:** still Cashew's (`com.budget.tracker_app`). Rename them before publishing to the stores.
- **Phase 2:** add `dompet_id`, `created_by` and `paid_by` to the Drift tables; scope every query to the current Dompet; add the PowerSync connector; migrate existing local data into "Dompet Saya".
- **Invite-code brute force:** codes are 6 characters from a 31-letter alphabet (~887M combinations), valid for 7 days, with limited uses. Before launch, add rate limiting, e.g. a Supabase Edge Function or a `pg` attempt counter in front of `redeem_dompet_invite`.
- **Licence:** Sedompet is a fork of Cashew (GPL-3.0). Keep the licence and credit, and publish the source.
