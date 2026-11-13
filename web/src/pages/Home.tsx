import { useState } from "react";
import { q, type Account, type Transaction } from "../db/repo";
import { projectedRecurring } from "../db/money";
import { currentMonth, formatCompact, formatIDR, formatMonth, formatPeriodRange, periodRange, timeAgo, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Avatar, Card, Empty, Modal, Progress } from "../components/ui";
import { TxRow } from "./Transactions";
import { DueList } from "./Recurring";
import { Icon } from "../components/Icon";
import { BudgetIcon } from "./Budgets";
import { GoalRow } from "./Goals";
import { StartChecklist } from "../components/StartChecklist";
import { RecapCard } from "../components/RecapCard";

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return "Selamat pagi";
  if (h < 15) return "Selamat siang";
  if (h < 18) return "Selamat sore";
  return "Selamat malam";
}

/** Days left in the current budget month, today included. */
function daysLeftThisMonth() {
  return Math.round((Date.parse(periodRange(currentMonth()).to) - Date.parse(todayISO())) / 86_400_000) + 1;
}

export function Home({ onOpenTx, goTo }: { onOpenTx: (t: Transaction | null) => void; goTo: (page: string) => void }) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const month = currentMonth();
  const accounts = q.accounts(dompet.id, me.id);
  const sharedTotal = accounts.filter((a) => a.visibility === "shared").reduce((s, a) => s + a.balance_base, 0);
  const privateTotal = accounts.filter((a) => a.visibility === "private").reduce((s, a) => s + a.balance_base, 0);
  const totals = q.monthTotals(dompet.id, me.id, month);
  const byMember = q.spendingByMember(dompet.id, me.id, month);
  const topCats = q.spendingByCategory(dompet.id, me.id, month).slice(0, 3);
  const budgets = q.budgets(dompet.id, month);
  const family = budgets.find((b) => !b.category_id && !b.category_ids && !b.member_id && b.period === "monthly");
  const jars = budgets.filter((b) => b !== family).slice(0, 4);
  // "Total bulanan", or every budget combined when there is none.
  const overall = q.overallBudget(dompet.id, me.id, month);
  const activity = q.activity(dompet.id, 6);
  // Unfinished goals first.
  const goals = q.goals(dompet.id, me.id).sort((a, b) => Number(a.progress >= a.target) - Number(b.progress >= b.target));
  const recent = q.transactions(dompet.id, me.id, { limit: 4 });
  const familySpend = byMember.reduce((s, x) => s + x.total, 0);
  const days = daysLeftThisMonth();
  const [explainOpen, setExplainOpen] = useState(false);
  // Shared recurring items still to come this month (overdue ones included).
  const scheduled = projectedRecurring(dompet.id, me.id, "1970-01-01", periodRange(month).to);
  const sharedItems = scheduled.items.filter((i) => i.shared);
  const scheduledOut = sharedItems.filter((i) => i.kind === "expense").reduce((s, i) => s + i.amount, 0);
  const scheduledIn = sharedItems.filter((i) => i.kind === "income").reduce((s, i) => s + i.amount, 0);
  // Entries already recorded for a later date this month (not in balances yet).
  const dated = q.scheduledEntries(dompet.id, me.id, periodRange(month).to, true);
  // Expenses count; a transfer arriving in another shared account cancels its outgoing side;
  // other income is left out so the number stays on the safe side.
  const datedEffect = (e: (typeof dated)[number]) => (e.kind === "expense" ? -e.amount_base : e.flag === "transfer" ? e.amount_base : 0);
  const datedOut = -dated.reduce((s, e) => s + datedEffect(e), 0);
  const datedExpenseInPeriod = dated.filter((e) => e.kind === "expense" && !e.flag).reduce((s, e) => s + e.amount_base, 0);
  const upcoming = [
    ...sharedItems.map((i) => ({ date: i.date, name: i.name, effect: i.kind === "expense" ? -i.amount : 0, shown: i.kind === "expense" ? -i.amount : i.amount, source: "rutin" as const })),
    ...dated.map((e) => ({ date: e.date, name: e.note || e.category_name || "Transfer", effect: datedEffect(e), shown: e.kind === "expense" ? -e.amount_base : e.amount_base, source: "dicatat" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const free = sharedTotal - scheduledOut - datedOut;

  let mood: { emoji: string; text: string } | null = null;
  if (overall) {
    const pct = overall.spent / overall.amount;
    const left = overall.amount - overall.spent;
    mood =
      pct > 1
        ? { emoji: "😬", text: `Sudah lewat ${formatIDR(-left)} dari rencana. Yuk rem sedikit sampai akhir bulan.` }
        : pct > 0.8
          ? { emoji: "🤏", text: `Tinggal ${formatIDR(left)} untuk ${days} hari lagi. Hati-hati ya.` }
          : { emoji: "😊", text: `Masih aman! Sisa ${formatIDR(left)}, kira-kira ${formatIDR(Math.floor(left / days))} per hari.` };
  }

  return (
    <div className="space-y-5">
      <div className="pop-in">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">
          {greeting()}, {me.name} 👋
        </h1>
        <p className="text-slate-500">Begini kabar dompet keluarga hari ini.</p>
      </div>

      {/* The shared wallet */}
      <button onClick={() => goTo("akun")} className="pop-in relative block w-full overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-500 via-brand-600 to-brand-700 p-6 text-left text-white shadow-[0_18px_40px_-18px_rgba(212,80,46,0.7)]">
        <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-16 right-10 h-40 w-40 rounded-full bg-sun-400/25" />
        <span className="relative flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-100">Uang keluarga sekarang</span>
          <span className="flex -space-x-2">
            {members.slice(0, 5).map((m) => (
              <span key={m.id} className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm ring-2 ring-brand-600">
                {m.emoji}
              </span>
            ))}
          </span>
        </span>
        <span className="num relative mt-2 block text-4xl font-extrabold tracking-tight">{formatIDR(sharedTotal)}</span>
        {privateTotal > 0 && <span className="relative mt-1 block text-xs text-brand-100">+ {formatIDR(privateTotal)} di tabungan pribadimu 🔒</span>}
        <span className="relative mt-5 grid grid-cols-2 gap-3">
          <span className="rounded-2xl bg-white/15 px-4 py-3">
            <span className="block text-xs text-brand-100">Masuk {formatPeriodRange(month) ? "periode ini" : "bulan ini"}</span>
            <span className="num font-bold">+{formatCompact(totals.income)}</span>
          </span>
          <span className="rounded-2xl bg-white/15 px-4 py-3">
            <span className="block text-xs text-brand-100">Keluar {formatPeriodRange(month) ? "periode ini" : "bulan ini"}</span>
            <span className="num font-bold">−{formatCompact(totals.expense)}</span>
            {datedExpenseInPeriod > 0 && <span className="block text-[11px] text-brand-100">{formatCompact(datedExpenseInPeriod)} bertanggal nanti</span>}
          </span>
        </span>
      </button>
      <div className="-mt-3 flex items-center justify-between gap-2 px-2 text-xs">
        <span className="text-slate-500">
          {scheduledOut > 0 || datedOut !== 0 ? (
            <>
              Uang bebas ≈ <b className={free < 0 ? "text-red-600" : "text-slate-700"}>{formatIDR(free)}</b> setelah{" "}
              {scheduledOut > 0 && datedOut !== 0 ? "tagihan & catatan terjadwal" : scheduledOut > 0 ? "tagihan rutin" : "catatan terjadwal"} bulan ini
            </>
          ) : (
            "Tidak ada tagihan rutin tersisa bulan ini"
          )}
        </span>
        <button onClick={() => setExplainOpen(true)} className="shrink-0 font-semibold text-brand-700 underline decoration-brand-200 underline-offset-2">
          Kenapa segini?
        </button>
      </div>
      <BalanceExplainer
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        accounts={accounts}
        sharedTotal={sharedTotal}
        privateTotal={privateTotal}
        income={totals.income}
        expense={totals.expense}
        upcoming={upcoming}
        free={free}
        datedExpense={datedExpenseInPeriod}
        scheduledIn={scheduledIn}
        budgetLeft={overall ? overall.amount - overall.spent : null}
        days={days}
      />

      <StartChecklist onOpenTx={onOpenTx} />

      <DueList />

      {overall && mood && (
        <Card className="pop-in">
          <div className="flex gap-3">
            <span className="text-4xl leading-none">{mood.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-800">
                Bulan {formatMonth(month).split(" ")[0]} terpakai {formatCompact(overall.spent)} dari {formatCompact(overall.amount)}
              </p>
              {formatPeriodRange(month) && <p className="text-xs text-slate-400">Periode {formatPeriodRange(month)}</p>}
              <p className="mt-0.5 text-sm text-slate-500">{mood.text}</p>
              {overall.combined > 0 && (
                <p className="mt-1 text-xs text-slate-400">Gabungan {overall.combined} anggaran. Buat anggaran tanpa kategori untuk batas total.</p>
              )}
              <div className="mt-3">
                <Progress value={overall.spent} max={overall.amount} />
              </div>
            </div>
          </div>
        </Card>
      )}

      <RecapCard
        budgetLine={
          overall
            ? `🐷 Anggaran ${formatMonth(month).split(" ")[0]}: terpakai ${Math.round((overall.spent / overall.amount) * 100)}%, ${
                overall.amount - overall.spent >= 0
                  ? `sisa ${formatCompact(overall.amount - overall.spent)} (±${formatCompact(Math.floor((overall.amount - overall.spent) / days))}/hari)`
                  : `lewat ${formatCompact(overall.spent - overall.amount)}`
              }`
            : undefined
        }
      />

      {goals.length > 0 && (
        <Card
          className="pop-in"
          title="Tujuan keluarga 🎯"
          action={
            <button onClick={() => goTo("tujuan")} className="text-sm font-semibold text-brand-700">
              Lihat semua
            </button>
          }
        >
          <ul className="space-y-3">
            {goals.slice(0, 3).map((g) => (
              <li key={g.id}>
                <button className="w-full text-left" onClick={() => goTo("tujuan")}>
                  <GoalRow g={g} compact />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Who spent what */}
      <section className="pop-in">
        <div className="mb-2 flex items-end justify-between px-1">
          <h2 className="text-lg font-bold text-slate-800">Siapa belanja apa?</h2>
          <span className="text-xs font-medium text-slate-400">bulan ini</span>
        </div>
        <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
          {byMember.map((x) => {
            const share = familySpend ? Math.round((x.total / familySpend) * 100) : 0;
            return (
              <div key={x.id} className="w-36 shrink-0 snap-start rounded-3xl bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
                <Avatar emoji={x.emoji} colour={x.colour} size={48} />
                <p className="mt-3 font-bold text-slate-800">
                  {x.name}
                  {x.id === me.id && <span className="text-xs font-semibold text-slate-400"> (kamu)</span>}
                </p>
                <p className="num text-sm font-semibold text-slate-600">{formatCompact(x.total)}</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full" style={{ width: `${share}%`, background: x.colour }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{x.total ? `${share}% dari belanja keluarga` : "belum belanja"}</p>
              </div>
            );
          })}
        </div>
        {topCats.length > 0 && (
          <p className="px-1 text-sm text-slate-500">
            Paling banyak untuk {topCats.map((c, i) => (
              <span key={c.id ?? i}>
                {i > 0 && (i === topCats.length - 1 ? " dan " : ", ")}
                <b className="text-slate-700">
                  <Icon value={c.icon} size={16} /> {c.name}
                </b>
              </span>
            ))}
            .
          </p>
        )}
      </section>

      {/* Family chat-style activity */}
      <Card title="Kabar keluarga 💬" className="pop-in">
        {activity.length === 0 ? (
          <Empty icon="🕊️" title="Belum ada kabar" />
        ) : (
          <ul className="space-y-3">
            {activity.map((a) => {
              const mine = a.member_id === me.id;
              return (
                <li key={a.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
                  <Avatar emoji={a.member_emoji ?? "👤"} colour={a.member_colour ?? "#b29d8b"} size={30} />
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-md bg-brand-100 text-brand-800" : "rounded-bl-md bg-slate-100 text-slate-700"}`}>
                    <p>
                      <b>{mine ? "Kamu" : (a.member_name ?? "Seseorang")}</b> {a.message}
                    </p>
                    <p className={`mt-0.5 text-[11px] ${mine ? "text-brand-700/70" : "text-slate-400"}`}>{timeAgo(a.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Budget jars */}
      {jars.length > 0 && (
        <section className="pop-in">
          <div className="mb-2 flex items-end justify-between px-1">
            <h2 className="text-lg font-bold text-slate-800">Anggaran keluarga 🐷</h2>
            <button className="text-sm font-semibold text-brand-700" onClick={() => goTo("anggaran")}>
              Semua →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {jars.map((b) => {
              const left = b.limit - b.spent;
              return (
                <button key={b.id} onClick={() => goTo("anggaran")} className="rounded-3xl bg-white p-4 text-left shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
                  <BudgetIcon b={b} />
                  <p className="mt-1 truncate font-bold text-slate-800">{b.name}</p>
                  {b.period !== "monthly" && <p className="text-[11px] font-semibold text-brand-700">{b.periodLabel.split(" (")[0]}</p>}
                  <p className={`num text-xs font-semibold ${left < 0 ? "text-red-600" : "text-slate-500"}`}>
                    {left < 0 ? `lewat ${formatCompact(-left)}` : `sisa ${formatCompact(left)}`}
                  </p>
                  <div className="mt-2">
                    <Progress value={b.spent} max={b.limit} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <Card
        title="Catatan terakhir"
        className="pop-in"
        action={
          <button className="text-sm font-semibold text-brand-700" onClick={() => goTo("riwayat")}>
            Riwayat →
          </button>
        }
      >
        {recent.length === 0 ? (
          <Empty icon="✍️" title="Belum ada catatan">
            Tekan tombol <b>+</b> di bawah untuk mencatat.
          </Empty>
        ) : (
          <ul className="-mx-2">
            {recent.map((t) => (
              <TxRow key={t.id} t={t} onClick={() => onOpenTx(t)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function BalanceExplainer(p: {
  open: boolean;
  onClose: () => void;
  accounts: Account[];
  sharedTotal: number;
  privateTotal: number;
  income: number;
  expense: number;
  upcoming: { date: string; name: string; effect: number; shown: number; source: "rutin" | "dicatat" }[];
  free: number;
  datedExpense: number;
  scheduledIn: number;
  budgetLeft: number | null;
  days: number;
}) {
  const shared = p.accounts.filter((a) => a.visibility === "shared");
  const today = todayISO();
  const Row = ({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) => (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={strong ? "font-bold text-slate-800" : "text-slate-600"}>
        {label}
        {hint && <span className="block text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      <span className={`num shrink-0 ${strong ? "font-extrabold text-slate-800" : "font-semibold text-slate-700"}`}>{value}</span>
    </li>
  );
  return (
    <Modal open={p.open} onClose={p.onClose} title="Kenapa segini?">
      <div className="space-y-5 text-sm">
        <section>
          <h3 className="mb-1 font-bold text-slate-800">Uang keluarga sekarang</h3>
          <p className="mb-1 text-xs text-slate-500">Jumlah saldo semua akun bersama: saldo awal + semua pemasukan − semua pengeluaran, termasuk transfer.</p>
          <ul className="divide-y divide-slate-100">
            {shared.map((a) => (
              <Row key={a.id} label={a.name} value={formatIDR(a.balance_base)} hint={a.currency !== "IDR" ? `${a.currency}, dikonversi ke rupiah` : undefined} />
            ))}
            <Row label="Total" value={formatIDR(p.sharedTotal)} strong />
          </ul>
          {p.privateTotal > 0 && <p className="mt-1 text-xs text-slate-500">Tabungan pribadimu ({formatIDR(p.privateTotal)}) tidak dihitung di sini dan hanya kamu yang melihatnya 🔒</p>}
        </section>

        <section>
          <h3 className="mb-1 font-bold text-slate-800">Masuk & keluar bulan ini</h3>
          <ul className="divide-y divide-slate-100">
            <Row label="Masuk" value={`+${formatIDR(p.income)}`} />
            <Row label="Keluar" value={`−${formatIDR(p.expense)}`} />
          </ul>
          <p className="mt-1 text-xs text-slate-500">Transfer antar akun, koreksi saldo dan pinjaman tidak dihitung sebagai pemasukan/pengeluaran, karena uangnya hanya pindah tempat.</p>
          {p.datedExpense > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Keluar sudah termasuk {formatIDR(p.datedExpense)} yang dicatat untuk tanggal nanti. Saldo baru berkurang saat tanggalnya tiba.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-1 font-bold text-slate-800">Uang bebas sampai akhir bulan</h3>
          {p.upcoming.length === 0 ? (
            <p className="text-xs text-slate-500">Tidak ada tagihan rutin atau catatan bertanggal nanti yang tersisa bulan ini.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              <Row label="Uang keluarga sekarang" value={formatIDR(p.sharedTotal)} />
              {p.upcoming.map((i, idx) => (
                <Row
                  key={idx}
                  label={i.name}
                  hint={
                    i.source === "dicatat"
                      ? `sudah dicatat untuk ${i.date.slice(8)}/${i.date.slice(5, 7)}`
                      : i.date < today
                        ? "tagihan rutin, sudah jatuh tempo"
                        : `tagihan rutin, jatuh tempo ${i.date.slice(8)}/${i.date.slice(5, 7)}`
                  }
                  value={i.effect !== 0 ? `${i.effect < 0 ? "−" : "+"}${formatIDR(Math.abs(i.effect))}` : `(+${formatIDR(Math.abs(i.shown))})`}
                />
              ))}
              <Row label="Uang bebas" value={formatIDR(p.free)} strong />
            </ul>
          )}
          {p.upcoming.some((i) => i.effect === 0) && (
            <p className="mt-1 text-xs text-slate-500">Pemasukan (dalam kurung) belum ditambahkan, supaya hitungannya aman kalau telat masuk.</p>
          )}
        </section>

        {p.budgetLeft !== null && (
          <section>
            <h3 className="mb-1 font-bold text-slate-800">Jatah per hari</h3>
            <p className="text-slate-600">
              Sisa anggaran {formatIDR(p.budgetLeft)} ÷ {p.days} hari tersisa (termasuk hari ini) ={" "}
              <b className="num">{formatIDR(Math.max(0, Math.floor(p.budgetLeft / p.days)))}</b> per hari.
            </p>
          </section>
        )}
      </div>
    </Modal>
  );
}
