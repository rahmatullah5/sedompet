# Competitor research: Seruma → Sedompet improvement plan

_Researched 13 Nov 2026 from seruma.app/hello (landing) and seruma.app/coba-demo (live interactive demo, "Keluarga Demo" account)._

---

## 1. Seruma at a glance

| | |
|---|---|
| Tagline | "Semua urusan keluarga, akhirnya ada di satu tempat" — money, bills, schedule, house in one app |
| Target | Married couple (suami & istri), each with own login on one family dataset |
| Company | PT. Jadi Multi Kreasi (also runs @jadikan.id) |
| Platforms | Web (desktop + tablet layouts), Android (Play), iOS (App Store) |
| Traction | 2,707 families joined; ★4.9 from 90 Google Play reviews |
| Pricing | Early-access lifetime Rp99.000 (covers 2 accounts) → later Rp40.000/month. Paid by QRIS / bank transfer, manual via WhatsApp admin |
| Trust signals | Rules co-designed with a certified financial planner (CFP, 39k IG followers); AES-256 for sensitive data, daily encrypted backup |
| Growth loops | Free WhatsApp community group, in-app feature request board, affiliate program (commission), prominent "Coba Demo" CTA, scarcity banner inside demo |

### Positioning difference

- **Seruma** = "household operating system" for a couple: finance **plus** calendar, home/vehicle maintenance, relationship features (Conversation Cards, Love Timeline, journal, date night).
- **Sedompet** = "satu dompet" for **any group** (family incl. kids with roles, kos, trips), free, open source, phone + PIN with no email, local-first/offline.

Do not copy Seruma's breadth. Copy its **finance depth and polish**, and lean into what Seruma can't do (groups beyond couples, kids, free/open, offline).

---

## 2. Seruma feature inventory (observed in demo)

### Home (Beranda)
- Greeting card with time/date, optional weather (home location)
- Icon grid shortcuts, **user-customisable** ("pilih fitur yang kamu pakai" — hide unused features, reorder home icons)
- Today's agenda with done counter, upcoming maintenance with "X hari lagi"
- Finance summary: wallet filter (multi-select), "pos" filter (Keluarga / Pribadi Andri)
- **Net worth** (Harta − Utang) on Home
- **Saldo aktif** (cumulative, not reset monthly, excludes goal money) with "Kenapa segini?" explainer
- Per-person balances, income with "Rp X masuk tapi bukan penghasilan" (opening balances, not income), spending with "Rp X bertanggal nanti" (future-dated)
- Recent transactions grouped by day, each with person avatar, category, pos, wallet
- "Insight Minggu Ini" card
- FAB → transfer / add task / add income / add expense

### Keuangan tab
- **Neraca keluarga**: net worth, assets per owner (Andri / Anita / Bersama / unassigned), change vs last month end
- Configurable finance menu: Transaksi, Anggaran & Kategori, Utang Piutang, Goal & Tabungan, Aset & Investasi, Alokasi, Wallet & Transfer, Transaksi Rutin, Laporan
- Tools: **Simulasi Cicilan/KPR**, **Dana Pendidikan calculator**, **Groceries** (per-item list + receipt scan)
- **Uang bebas** = saldo aktif − already-scheduled spending
- **Spending calendar heatmap** (amount per day, "paling boros" day, dashed = future-dated, tap date to record)
- "Perlu perhatian" — e.g. no monthly budget set yet → CTA
- Coach-mark tooltips on first visit

### Add expense form
- Modes: **Scan** (receipt OCR), **Chat AI** (natural language), Manual, Rutin, **Banyak** (bulk entry)
- Type: normal spend vs pay debt / lend (cicilan, bon)
- Admin fee field (transfer/QRIS fee)
- **Split across multiple categories**; installment (cicilan) option
- Date + optional time
- Pos (Keluarga / Pribadi)
- **Kebutuhan vs Keinginan** (need vs want) tag
- Purpose, **merchant (tempat beli)**, note (500 chars), **receipt photo**
- Who spent: person A / person B / **Bersama** (1 record) / **Dibagi berdua** (2 records by default ratio, editable per transaction)

### Allocation (Alokasi Pendapatan)
- Split income into "pos" by % or nominal, default **50/10/20/20** (Kebutuhan Pokok / Dana Darurat / Investasi / Lain-lain)
- "Pakai pemasukan bulan ini" auto-fill; each pos can be linked to budget categories → "Simpan ke Anggaran"
- Read-only planner: records no transactions

### Assets & investments
- Gold (Antam, per gram), stocks (IDX, per lot/share, broker tag e.g. Stockbit), property, etc.
- **Auto price update** for gold & stocks; manual update for others
- Cost basis vs market, P/L per asset and per class, monthly investment contributions
- Portfolio allocation %, diversification warning, **target allocation & rebalance** suggestions

### Goals
- Target, progress %, remaining, optional deadline, "+ Nabung", which wallet holds the money
- Education fund calculator linked

### Reports
- Daily / weekly / monthly / yearly, wallet & pos filters
- Tabs: **Arus Kas**, **Kekayaan**, Rincian
- Cash flow statement: in, out (incl. credit card), net free cash; recording adjustments (opening balances) shown separately; **reconciliation check** "✓ semua transaksi terhitung (sesuai saldo wallet)"
- Unrealised asset value change shown separately from cash flow
- 6-month trend with averages (avg in / out / saldo)

### Calendar & home
- Family calendar (day/month) with filters: maintenance, payments & shopping, family events, "from other features"
- Maintenance: vehicles (next service, STNK/tax), house, electronics
- "Link penting" (store Google Drive doc links)

### Couple (Berdua)
- Love timeline, date night scheduling, Conversation Cards, monthly reflection, journal, daily tip

### Settings
- Account & security (email, password, PIN)
- Notifications (phone push: budget exceeded, task due, etc.), weather
- Display & features (feature toggles, home shortcuts, finance menu)
- Wallet & pos management
- **Budget period start day** (match payday, affects budgets, reports, recurring)
- Main currency with locked rates (IDR, USD, SGD, MYR, TWD, AUD, EUR, SAR, JPY…)
- **Default split ratio** for "Bersama"
- **Data & backup**: full Excel backup (10 data types, optional .zip with photos/audio); Excel import via templates incl. **bank / credit-card statement (mutasi)**; **Google Sheets sync**; **ICS calendar feed** to phone/Google Calendar (rotatable secret link)
- **Trash / restore deleted data**, reset, close account
- **Private account**: personal money; partner only sees movements in/out and totals
- Help & FAQ with setup guide, feature request board, affiliate, about

---

## 3. Feature gap matrix

Legend: ✅ have · 🟡 partial · ❌ missing

| Area | Seruma | Sedompet | Note |
|---|---|---|---|
| Shared ledger, who-paid per entry | ✅ | ✅ | parity |
| Roles beyond couple (owner/admin/member/viewer, kids) | ❌ (couple only) | ✅ | **Sedompet edge** |
| Multiple dompets (kos, trip) | ❌ | ✅ | **Sedompet edge** |
| Per-member allowance budget | ❌ | ✅ | **Sedompet edge** |
| Per-day leftover | ❌ | ✅ | **Sedompet edge** |
| 3-month forecast | ❌ | ✅ | **Sedompet edge** |
| Offline / local-first | ❌ | ✅ (no PWA yet) | install story missing |
| Free + open source, phone+PIN no email | ❌ (paid) | ✅ | **Sedompet edge** |
| Private vs shared money | ✅ pos + private account | ✅ account visibility | parity-ish |
| Split "Bersama" / divide by ratio | ✅ | ❌ | planned (split bills) |
| Split one transaction across categories | ✅ | ❌ | |
| Need vs want tag, merchant, receipt photo | ✅ | ❌ | |
| Admin fee on expense | ✅ | 🟡 transfers only | |
| Future-dated entries & "uang bebas" | ✅ | 🟡 recurring projection | |
| Budget period start day (payday) | ✅ | ❌ | |
| Spending calendar heatmap | ✅ | ❌ | |
| Net worth / balance sheet | ✅ | ❌ | data exists (accounts + loans) |
| Income allocation (50/30/20 pos) | ✅ | ❌ | |
| Assets with auto prices (gold, IDX) | ✅ | 🟡 investment account type | |
| Loan/KPR installment calculator | ✅ | ❌ | |
| Cash-flow report with reconciliation | ✅ | 🟡 | |
| Weekly insight | ✅ | ❌ | |
| Receipt OCR / AI chat entry / bulk entry | ✅ | ❌ | |
| Push notifications | ✅ | ❌ | landing claims reminders |
| Export (Excel/CSV) & full backup | ✅ | ❌ | **trust gap** |
| Bank statement import | ✅ | ❌ | Cashew import only |
| Google Sheets sync / ICS feed | ✅ | ❌ | |
| Trash / restore | ✅ | ❌ | |
| Feature toggles / home customisation | ✅ | ❌ | |
| Onboarding coach marks / help & FAQ | ✅ | ❌ | |
| Native mobile apps | ✅ | ❌ | PWA/TWA path |
| Calendar, maintenance, couple features | ✅ | ❌ | **intentionally skip** |

---

## 4. Takeaways

1. **Seruma wins on finance depth & explanation.** Every number has a "kenapa segini?" / "rincian" link and separates real income from opening balances, today from future-dated. This builds trust. Sedompet should adopt that "explainable numbers" pattern.
2. **Data ownership is table stakes.** Seruma offers Excel backup, import, Sheets sync, trash restore. Sedompet has none — biggest trust gap, and contradicts the "data kamu bukan dijual" promise if users can't take it out.
3. **Entry speed matters.** Scan / AI chat / bulk modes reduce friction; reviews specifically praise receipt photo → auto input.
4. **Landing claims must match product.** Sedompet's landing mentions reminders and offline, but there is no push and no PWA manifest. Fix before growth push.
5. **Sedompet's moat**: groups beyond couples (kids, kos, trips), free/open, offline, phone+PIN. Seruma is couple-only and paid — Sedompet should market directly to those segments rather than compete as a "couple OS".
6. **Go-to-market**: Seruma's growth comes from a WA community, an expert endorsement, Play reviews, an in-app feature request board and affiliates — cheap tactics Sedompet can partially reuse.

---

## 5. Improvement plan

Sizing: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks (solo dev).

### Phase 0 — Trust & honesty fixes (week 1–2)

> **Status (13 Nov 2026): done.** CSV export (transactions, account balances, loans) next to the existing .sqlite backup; PWA (manifest, icons, service worker, "Pasang di HP" card); Sampah with 30-day restore + "Urungkan" toast for transactions, transfers, budgets, goals, recurring and loans (local to the deleting device, not synced); "Kenapa segini?" breakdown + "uang bebas" line on Beranda; landing copy aligned. JSON restore into a cloud Dompet is not done.

| # | Item | Size | Detail |
|---|---|---|---|
| 0.1 | **Export & backup** | M | Export transactions CSV + full JSON backup per dompet (all tables), restore from JSON. Later XLSX via SheetJS. Settings → "Data & backup" section |
| 0.2 | **PWA install** | S | `manifest.webmanifest`, icons, service worker (vite-plugin-pwa) caching app shell → matches "works offline" claim; "Pasang di HP" prompt |
| 0.3 | **Trash / undo** | M | Soft delete (`deleted_at`) for transactions, accounts, budgets; 30-day "Sampah" with restore; undo toast after delete |
| 0.4 | **Landing copy audit** | S | Change "reminders" wording until push exists; add segments (kos, trip, kids) as explicit differentiators vs couple-only apps |
| 0.5 | **Explainable numbers** | S | Add "Kenapa segini?" sheet on Home balance & per-day leftover: formula breakdown (opening balances, transfers excluded, scheduled recurring) |

### Phase 1 — Finance depth (week 3–6)

> **Status (13 Nov 2026): 1.1, 1.2, 1.5 done.** Patungan with settle-up (split_with on transactions), payday month start (period_start_day), Neraca page with 6-month trend and per-owner view. Also shipped: paid plans with expiry (read-only Dompet when the plan ends). Next: 1.3 richer transaction form, 1.4 future-dated + uang bebas, 1.6 spending calendar.

| # | Item | Size | Detail |
|---|---|---|---|
| 1.1 | **Split / shared expense** | L | Payer = member / "Bersama" / "Dibagi" with default ratio per dompet (editable per tx). Add `transaction_splits(tx_id, member_id, share)`. Unlocks "who owes whom" settle-up for kos & trips — a feature Seruma lacks |
| 1.2 | **Budget period start day** | M | Dompet setting `period_start_day` (1–31), used in budgets, reports, per-day leftover |
| 1.3 | **Richer transaction form** | M | Split across categories, admin fee, need/want tag, merchant, optional time, receipt photo (Supabase Storage, compressed client-side) |
| 1.4 | **Future-dated & "uang bebas"** | M | Allow future dates; Home shows "saldo" vs "uang bebas" (minus scheduled recurring + future-dated until period end) |
| 1.5 | **Net worth (Neraca)** | M | Assets (accounts incl. investment) − liabilities (credit accounts + loans borrowed), per holder/shared, delta vs last month; card on Reports + Home |
| 1.6 | **Spending calendar heatmap** | S | Month grid in History/Reports, amount per day, tap → filtered list / add on that date |
| 1.7 | **Cash-flow report v2** | M | Separate real income vs opening balance/adjustments, include reconciliation check against account balances; daily/weekly/yearly toggles |
| 1.8 | **Bulk entry** | S | Multi-row quick add (date, amount, category, payer) for catching up after a trip |

### Phase 2 — Engagement & automation (week 7–12)

| # | Item | Size | Detail |
|---|---|---|---|
| 2.1 | **Web push notifications** | L | SW + VAPID, Supabase Edge Function cron: bill/loan due tomorrow, budget 80%/100%, "Anita mencatat −Rp 435.000" (opt-in per member), weekly recap |
| 2.2 | **Weekly insight + WA recap share** | M | Auto weekly summary (top categories, vs last week, who spent most, budgets at risk) + "Bagikan ke WhatsApp" text/image — directly solves Sedompet's own pitch "rekap hilang di grup WA" |
| 2.3 | **Quick add via natural language** | M | "makan siang 35rb gopay ayah" → parsed tx. Start with a local regex parser (amount + rb/jt, wallet & member names, category keywords); optional LLM fallback later |
| 2.4 | **Receipt OCR** | L | Photo → total, merchant, date (Tesseract.js on-device to keep privacy/offline story, or server LLM vision as opt-in) |
| 2.5 | **Bank statement import** | M | CSV import with column mapping + presets (BCA, Mandiri, BRI, Jago, GoPay), duplicate detection |
| 2.6 | **Income allocation (pos)** | M | 50/30/20 or custom % plan, "pakai pemasukan bulan ini", one-tap convert to budgets |
| 2.7 | **ICS feed** | S | Secret per-member calendar URL with recurring bills and loan due dates (rotatable) |
| 2.8 | **Onboarding & help** | M | Coach marks on first visit per screen, empty-state CTAs ("Belum ada anggaran → buat"), FAQ page |

### Phase 3 — Bigger bets (quarter 2)

| # | Item | Size | Detail |
|---|---|---|---|
| 3.1 | **Kids mode** | L | Viewer/kid role gets simple screen: allowance left, savings goal piggy, request money from parents → approve creates transfer. Strong differentiator vs Seruma |
| 3.2 | **Group / trip mode settle-up** | M | Builds on 1.1: balances between members, minimal transfers to settle, "lunasi" creates transfer |
| 3.3 | **Assets with prices** | L | Gold (Antam per gram) & IDX stocks price feed (scheduled fetch), cost basis, P/L, allocation chart |
| 3.4 | **Loan / KPR calculator** | M | Annuity, flat, tiered rate; generate recurring installments + amortisation table on a loan |
| 3.5 | **Feature toggles & home customisation** | M | Hide modules (loans, goals, assets), reorder Home cards — keeps app simple for kos/trip users |
| 3.6 | **Android app via TWA** | M | Package PWA for Play Store; reviews become a growth channel like Seruma's |
| 3.7 | **Google Sheets sync** | L | Optional one-way export to a sheet the user owns |

### Explicitly out of scope
Calendar/agenda, vehicle & house maintenance, weather, Conversation Cards, love timeline, journal. These fit Seruma's "household OS for couples"; for Sedompet they dilute the "satu dompet" focus.

### Growth & community (parallel, low effort)
- Public **feature request / roadmap** page (GitHub Discussions or a simple Supabase table) — Seruma users praise fast response to suggestions.
- WhatsApp/Telegram community for early users.
- Demo already exists — make "Coba demo" the primary CTA and add a persona switcher hint (try as parent vs kid).
- Collect testimonials once Phase 1 ships; show them on landing.
- Keep free + open source as a headline vs Seruma's Rp40.000/month future price.

---

## 6. Suggested order (top 10)

1. Export & backup (0.1)
2. PWA install (0.2)
3. Split / shared expense (1.1)
4. Budget period start day (1.2)
5. Trash / undo (0.3)
6. Net worth (1.5)
7. Richer transaction form (1.3)
8. Web push (2.1)
9. Weekly insight + WA recap share (2.2)
10. Quick add natural language (2.3)

## Success metrics
- Weekly active dompets with ≥2 members recording
- Entries per active member per week (entry friction)
- % users who exported/backed up (trust)
- Push opt-in rate; D30 retention per dompet
