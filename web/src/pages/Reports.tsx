import { useState, useSyncExternalStore } from "react";
import { budgetCovers, q } from "../db/repo";
import { projectedRecurring, variableTotals } from "../db/money";
import { currentMonth, formatCompact, formatIDR, formatMonth, formatPeriodRange, periodDay, periodRange, shiftMonth, toISODate, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Card, cx } from "../components/ui";
import { cashFlow, netWorth } from "../db/networth";
import { netWorthTrend } from "./Neraca";
import { Icon } from "../components/Icon";

// Chart colours (validated: lightness/chroma pass; CVD 7.4 => secondary
// encoding via legend, fixed order and the table view).
const INCOME = "#2fb67c";
const EXPENSE = "#f47c5a";
const REFERENCE = "#b29d8b"; // neutral: last month / budget lines
const GRID = "#efe5da";
const INK_MUTED = "#8a7563";

const shortMonth = (m: string) => formatMonth(m).slice(0, 3);

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------------------
// Income basis for forecasts, remembered on this device and shared by every
// chart on the page ("recurring" = only items registered in Rutin).
// ---------------------------------------------------------------------------
type IncomeBasis = "recurring" | "recurring+avg";
const BASIS_KEY = "sedompet.forecast.incomeBasis";
let basis: IncomeBasis = (() => {
  try {
    return localStorage.getItem(BASIS_KEY) === "recurring" ? "recurring" : "recurring+avg";
  } catch {
    return "recurring+avg";
  }
})();
const basisListeners = new Set<() => void>();
function useIncomeBasis(): [IncomeBasis, (b: IncomeBasis) => void] {
  const value = useSyncExternalStore(
    (l) => {
      basisListeners.add(l);
      return () => basisListeners.delete(l);
    },
    () => basis,
  );
  const set = (b: IncomeBasis) => {
    basis = b;
    try {
      localStorage.setItem(BASIS_KEY, b);
    } catch {
      /* ignore */
    }
    basisListeners.forEach((l) => l());
  };
  return [value, set];
}

// ---------------------------------------------------------------------------
// Forecast maths
// ---------------------------------------------------------------------------
function useForecast(horizon = 3) {
  const { dompet, me } = useCurrent();
  const today = todayISO();
  const now = new Date();
  const month = currentMonth();
  // The budget month may start on payday, so "day" is the day number inside it.
  const { days: daysInMonth, to: monthEnd } = periodRange(month);
  const day = periodDay(today, month);
  const tomorrow = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

  // Typical everyday (non-recurring) spending per day, from the last 90 days,
  // or since the first transaction when the family started more recently.
  const from90 = toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89));
  const first = q.firstTxDate(dompet.id, me.id);
  const historyDays = first && first > from90 ? Math.max(7, Math.round((Date.parse(today) - Date.parse(first)) / 86_400_000) + 1) : 90; // floor: one big first day shouldn't dominate
  const v90 = variableTotals(dompet.id, me.id, from90, today);
  const dailyVar = v90.expense / historyDays;
  const [incomeBasis, setIncomeBasis] = useIncomeBasis();
  const avgIncomePerMonth = (v90.income / historyDays) * 30;
  // "recurring" = only registered recurring income (salary etc.) is expected.
  const dailyVarIncome = incomeBasis === "recurring" ? 0 : v90.income / historyDays;

  const totals = q.monthTotals(dompet.id, me.id, month);
  const restOfMonth = projectedRecurring(dompet.id, me.id, tomorrow, monthEnd);
  const remainingDays = daysInMonth - day;
  const expenseEnd = totals.expense + restOfMonth.expense + dailyVar * remainingDays;
  const incomeEnd = totals.income + restOfMonth.income + dailyVarIncome * remainingDays;

  const balanceNow = q.accounts(dompet.id, me.id).reduce((s, a) => s + a.balance_base, 0);
  // Entries already recorded for later dates: in this month's totals, not in today's balance.
  const recordedAhead = q.scheduledEntries(dompet.id, me.id, periodRange(shiftMonth(month, Math.max(3, horizon))).to);
  const recordedNet = (from: string, to: string) =>
    recordedAhead.filter((e) => e.date >= from && e.date <= to).reduce((s, e) => s + (e.kind === "income" ? e.amount_base : -e.amount_base), 0);
  const balanceEnd = balanceNow + recordedNet(today, monthEnd) + (incomeEnd - totals.income) - (expenseEnd - totals.expense);

  // Three spending scenarios for the balance projection. "Normal" is the
  // 90-day daily average; "Hemat"/"Boros" use the family's own best and worst
  // full months of everyday (non-Rutin) spending from the last 6, and fall back
  // to ±15% when there is too little history. Rutin bills and income are the
  // same in every scenario.
  const pastRates: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = periodRange(shiftMonth(month, -i));
    if (!first || first > r.from) break; // month not fully recorded
    pastRates.push(variableTotals(dompet.id, me.id, r.from, r.to).expense / r.days);
  }
  const fromHistory = pastRates.length >= 2;
  const rates = {
    good: Math.min(fromHistory ? Math.min(...pastRates) : dailyVar, dailyVar * 0.85),
    normal: dailyVar,
    bad: Math.max(fromHistory ? Math.max(...pastRates) : dailyVar, dailyVar * 1.15),
  };
  type Scenario = keyof typeof rates;
  const endOfThisMonth = (rate: number) =>
    balanceNow + recordedNet(today, monthEnd) + (incomeEnd - totals.income) - (restOfMonth.expense + rate * remainingDays);

  // Next months: recurring items + typical variable flow, per scenario.
  const ahead = Array.from({ length: horizon }, (_, k) => {
    const m = shiftMonth(month, k + 1);
    const { from, to, days: last } = periodRange(m);
    const rec = projectedRecurring(dompet.id, me.id, from, to);
    const already = recordedNet(from, to);
    return {
      month: m,
      days: last,
      income: rec.income + dailyVarIncome * last + Math.max(0, already),
      fixedExpense: rec.expense + Math.max(0, -already),
      recurring: rec.items,
    };
  });
  const run = (sc: Scenario) => {
    let bal = endOfThisMonth(rates[sc]);
    return ahead.map((a) => (bal += a.income - a.fixedExpense - rates[sc] * a.days));
  };
  const paths = { good: run("good"), normal: run("normal"), bad: run("bad") };
  const trajectory = ahead.map((a, i) => ({
    ...a,
    expense: a.fixedExpense + rates.normal * a.days,
    balance: paths.normal[i],
    good: paths.good[i],
    bad: paths.bad[i],
  }));
  const scenarios = {
    rates,
    fromHistory,
    historyMonths: pastRates.length,
    start: { good: endOfThisMonth(rates.good), normal: balanceEnd, bad: endOfThisMonth(rates.bad) },
  };

  // Monthly limit: "Total bulanan", or every budget combined. A combined limit
  // only covers budgeted spending, so compare it with that spending, grown to
  // month end like the family forecast.
  const growth = totals.expense > 0 ? expenseEnd / totals.expense : daysInMonth / day;
  const ob = q.overallBudget(dompet.id, me.id, month);
  const overall = ob && { ...ob, projected: ob.combined ? Math.round(ob.spent * growth) : expenseEnd };
  // Every budget, forecast from its own data: spent so far + its Rutin bills
  // still due this month + its usual non-Rutin daily spending (90-day average)
  // for the days left. A bill already paid (e.g. SPP) is not counted again.
  const parentOf = new Map(q.categories(dompet.id).map((c) => [c.id, c.parent_id]));
  const usual = new Map(
    q.budgets(dompet.id, month, { range: { from: from90, to: today }, excludeRecurring: true }).map((b) => [b.id, b.spent / historyDays]),
  );
  const budgetOutlook = q
    .budgets(dompet.id, month, { wholeMonth: true })
    .map((b) => {
      // Budgets count shared accounts only, so do the Rutin bills here.
      const bills = restOfMonth.items
        .filter((i) => i.kind === "expense" && i.shared && budgetCovers(b, i.category_id, i.category_id ? (parentOf.get(i.category_id) ?? null) : null, i.paid_by))
        .reduce((s, i) => s + i.amount, 0);
      const daily = (usual.get(b.id) ?? 0) * remainingDays;
      const projected = Math.round(b.spent + bills + daily);
      return { id: b.id, name: b.name, limit: b.limit, spent: b.spent, bills, daily: Math.round(daily), projected, over: projected - b.limit };
    })
    .sort((a, b) => b.over / b.limit - a.over / a.limit);
  return {
    month, day, daysInMonth, totals, dailyVar, expenseEnd, incomeEnd, balanceNow, balanceEnd, restOfMonth, trajectory, scenarios, overall, budgetOutlook,
    incomeBasis, setIncomeBasis, avgIncomePerMonth, historyDays, excludedIncomeCategories: v90.excludedIncomeCategories,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const HORIZON_KEY = "sedompet.forecast.horizon";
function loadHorizon() {
  try {
    const v = Number(localStorage.getItem(HORIZON_KEY));
    return v >= 1 && v <= 12 ? v : 6;
  } catch {
    return 6;
  }
}

export function Reports() {
  useDbVersion();
  const [horizon, setHorizonState] = useState(loadHorizon);
  const setHorizon = (h: number) => {
    setHorizonState(h);
    try {
      localStorage.setItem(HORIZON_KEY, String(h));
    } catch {
      /* private mode */
    }
  };
  const f = useForecast(horizon);
  const overBudget = f.overall && f.overall.projected > f.overall.amount;
  const atRisk = f.budgetOutlook.filter((b) => b.over > 0);
  const daysLeft = Math.max(1, f.daysInMonth - f.day);
  const warn = overBudget || atRisk.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Laporan 📊</h1>
        <p className="text-sm text-slate-500">Ke mana uang keluarga pergi, dan perkiraan ke depan.</p>
      </div>

      {/* Forecast hero */}
      <Card className="pop-in">
        <p className="text-sm font-semibold text-slate-500">
          Perkiraan akhir {formatMonth(f.month)}
          {formatPeriodRange(f.month) && <span className="font-normal text-slate-400"> · {formatPeriodRange(f.month)}</span>}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Total pengeluaran</p>
            <p className="num text-2xl font-extrabold text-slate-800">{formatCompact(Math.round(f.expenseEnd))}</p>
            <p className="text-xs text-slate-500">sekarang {formatCompact(f.totals.expense)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Saldo di akhir bulan</p>
            <p className="num text-2xl font-extrabold text-slate-800">{formatCompact(Math.round(f.balanceEnd))}</p>
            <p className="text-xs text-slate-500">sekarang {formatCompact(f.balanceNow)}</p>
          </div>
        </div>
        <div className={cx("mt-4 space-y-2 rounded-2xl px-4 py-3 text-sm", warn ? "bg-red-50 text-red-800" : "bg-mint-100 text-slate-700")}>
          <p>
            {warn ? "⚠️ " : "✅ "}
            {f.overall && overBudget
              ? `Dengan kebiasaan sekarang, ${f.overall.combined ? "belanja yang dianggarkan" : "total pengeluaran"} bisa lewat ${f.overall.combined ? `gabungan ${f.overall.combined} anggaran` : "anggaran"} ${formatIDR(Math.round(f.overall.projected - f.overall.amount))}. Kurangi sekitar ${formatIDR(Math.ceil((f.overall.projected - f.overall.amount) / daysLeft))} per hari.`
              : f.budgetOutlook.length === 0
                ? `Rata-rata belanja harian keluarga ${formatIDR(Math.round(f.dailyVar))}. Buat anggaran supaya ada pembanding.`
                : atRisk.length > 0
                  ? `${atRisk.length} dari ${f.budgetOutlook.length} anggaran diperkirakan lewat di akhir bulan:`
                  : `Semua ${f.budgetOutlook.length} anggaran diperkirakan aman sampai akhir bulan. Lanjutkan!`}
          </p>
          {atRisk.length > 0 && (
            <ul className="space-y-1">
              {atRisk.map((b) => (
                <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-xl bg-white/70 px-3 py-1.5">
                  <span className="font-semibold">{b.name}</span>
                  <span className="num text-xs">
                    ≈ {formatCompact(b.projected)} / {formatCompact(b.limit)} · lebih {formatIDR(b.over)} · kurangi ≈ {formatIDR(Math.ceil(b.over / daysLeft))}/hari
                  </span>
                  <span className="num w-full text-[11px] opacity-75">
                    = sudah {formatCompact(b.spent)}
                    {b.bills > 0 && ` + rutin ${formatCompact(b.bills)}`}
                    {b.daily > 0 && ` + biasanya ${formatCompact(b.daily)} untuk ${daysLeft} hari lagi`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {f.restOfMonth.items.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Sudah termasuk {f.restOfMonth.items.length} tagihan/pemasukan rutin yang belum jatuh tempo bulan ini.
          </p>
        )}
      </Card>

      <PaceChart />
      <MonthlyChart />
      <CashFlowCard />
      <CategoryChart />
      <NeedWantCard />
      <NetWorthCard />

      <BalanceProjection f={f} horizon={horizon} setHorizon={setHorizon} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spending pace: cumulative this month vs last month, with forecast to month end
// ---------------------------------------------------------------------------
function PaceChart() {
  const { dompet, me } = useCurrent();
  const f = useForecast();
  const [hover, setHover] = useState<number | null>(null);
  const thisMonth = f.month;
  const lastMonth = shiftMonth(thisMonth, -1);
  const days = f.daysInMonth;
  // Day d of the budget month as a calendar date number (they differ when the month starts on payday).
  const startDate = new Date(periodRange(thisMonth).from + "T00:00");
  const dateOf = (d: number) => new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + d - 1).getDate();

  const cumulative = (rows: { day: number; total: number }[], upto: number) => {
    const out: number[] = [];
    let s = 0;
    for (let d = 1; d <= upto; d++) {
      s += rows.find((r) => r.day === d)?.total ?? 0;
      out.push(s);
    }
    return out;
  };
  // Against a combined limit, plot only the spending budgets cover.
  const combined = !!f.overall?.combined;
  const daily = (m: string) => (combined ? q.budgetCoveredDaily(dompet.id, me.id, m) : q.dailyExpense(dompet.id, me.id, m));
  const cur = cumulative(daily(thisMonth), f.day);
  const prev = cumulative(daily(lastMonth), days);
  const end = f.overall?.projected ?? f.expenseEnd;
  const budget = f.overall?.amount ?? null;

  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const max = niceMax(Math.max(end, budget ?? 0, ...prev, 1));
  const x = (d: number) => pad.l + ((d - 1) / (days - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [0, max / 2, max];

  const hovered = hover ?? null;
  return (
    <Card title="Laju belanja bulan ini">
      <Legend
        items={[
          { label: "Bulan ini", colour: EXPENSE, shape: "line" },
          { label: "Perkiraan", colour: EXPENSE, shape: "dash" },
          { label: formatMonth(lastMonth).split(" ")[0], colour: REFERENCE, shape: "line" },
          ...(budget ? [{ label: combined ? "Gabungan anggaran" : "Anggaran", colour: REFERENCE, shape: "dash" as const }] : []),
        ]}
      />
      {combined && (
        <p className="mt-1 text-xs text-slate-400">
          Belum ada anggaran total, jadi grafik ini hanya menghitung belanja yang masuk {f.overall?.combined} anggaranmu.
        </p>
      )}
      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full touch-none"
          role="img"
          aria-label={`Belanja kumulatif: ${formatIDR(cur[cur.length - 1] ?? 0)} sampai hari ini, perkiraan ${formatIDR(Math.round(end))} di akhir bulan.`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const d = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days - 1)) + 1;
            setHover(Math.min(days, Math.max(1, d)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                {formatCompact(t)}
              </text>
            </g>
          ))}
          {[1, 10, 20, days].map((d) => (
            <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
              {dateOf(d)}
            </text>
          ))}
          {budget && <line x1={pad.l} x2={W - pad.r} y1={y(budget)} y2={y(budget)} stroke={REFERENCE} strokeWidth={1.5} strokeDasharray="5 4" />}
          <path d={line(prev)} fill="none" stroke={REFERENCE} strokeWidth={2} strokeLinejoin="round" />
          {cur.length > 0 && (
            <>
              <path d={`M${x(f.day)},${y(cur[cur.length - 1])}L${x(days)},${y(end)}`} fill="none" stroke={EXPENSE} strokeWidth={2} strokeDasharray="6 5" />
              <path d={line(cur)} fill="none" stroke={EXPENSE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(f.day)} cy={y(cur[cur.length - 1])} r={4.5} fill={EXPENSE} stroke="#fff" strokeWidth={2} />
            </>
          )}
          {hovered && <line x1={x(hovered)} x2={x(hovered)} y1={pad.t} y2={H - pad.b} stroke={INK_MUTED} strokeWidth={1} />}
        </svg>
        {hovered && (
          <Tooltip leftPct={(x(hovered) / W) * 100}>
            <p className="text-xs font-semibold text-slate-500">Tanggal {dateOf(hovered)}</p>
            {hovered <= cur.length ? (
              <TipRow colour={EXPENSE} label="Bulan ini" value={cur[hovered - 1]} />
            ) : (
              <TipRow colour={EXPENSE} dashed label="Perkiraan" value={cur.length ? cur[cur.length - 1] + ((end - cur[cur.length - 1]) * (hovered - f.day)) / Math.max(1, days - f.day) : 0} />
            )}
            <TipRow colour={REFERENCE} label={formatMonth(lastMonth).split(" ")[0]} value={prev[hovered - 1] ?? 0} />
            {budget && <TipRow colour={REFERENCE} dashed label={combined ? "Gabungan anggaran" : "Anggaran"} value={budget} />}
          </Tooltip>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Income vs expense, last 6 months
// ---------------------------------------------------------------------------
function MonthlyChart() {
  const { dompet, me } = useCurrent();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(currentMonth(), i - 5));
  const data = q.monthlySeries(dompet.id, me.id, months);

  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 8, t: 12, b: 26 };
  const max = niceMax(Math.max(1, ...data.flatMap((d) => [d.income, d.expense])));
  const slot = (W - pad.l - pad.r) / data.length;
  const barW = Math.min(26, slot / 3);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const bar = (cx: number, v: number, colour: string, faded: boolean) => {
    const top = y(v);
    const h = H - pad.b - top;
    if (h <= 0) return null;
    const r = Math.min(4, h);
    // Rounded top, square base anchored on the axis.
    const d = `M${cx},${H - pad.b}V${top + r}Q${cx},${top} ${cx + r},${top}H${cx + barW - r}Q${cx + barW},${top} ${cx + barW},${top + r}V${H - pad.b}Z`;
    return <path d={d} fill={colour} opacity={faded ? 0.45 : 1} />;
  };

  return (
    <Card
      title="Masuk vs keluar"
      action={
        <button className="text-xs font-semibold text-brand-700" onClick={() => setTable((t) => !t)}>
          {table ? "Lihat grafik" : "Lihat tabel"}
        </button>
      }
    >
      {table ? (
        <table className="num w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-semibold">Bulan</th>
              <th className="py-1 text-right font-semibold">Masuk</th>
              <th className="py-1 text-right font-semibold">Keluar</th>
              <th className="py-1 text-right font-semibold">Selisih</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((d) => (
              <tr key={d.month}>
                <td className="py-1.5 capitalize">{formatMonth(d.month)}</td>
                <td className="py-1.5 text-right">{formatCompact(d.income)}</td>
                <td className="py-1.5 text-right">{formatCompact(d.expense)}</td>
                <td className="py-1.5 text-right font-semibold">{formatCompact(d.income - d.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <Legend
            items={[
              { label: "Masuk", colour: INCOME, shape: "rect" },
              { label: "Keluar", colour: EXPENSE, shape: "rect" },
            ]}
          />
          <div className="relative mt-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Pemasukan dan pengeluaran 6 bulan terakhir. Gunakan Lihat tabel untuk angkanya.">
              {[0, max / 2, max].map((t) => (
                <g key={t}>
                  <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
                  <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                    {formatCompact(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const cx = pad.l + slot * i + slot / 2;
                const faded = hover !== null && hover !== i;
                return (
                  <g key={d.month}>
                    {bar(cx - barW - 1, d.income, INCOME, faded)}
                    {bar(cx + 1, d.expense, EXPENSE, faded)}
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                      {shortMonth(d.month)}
                    </text>
                    {/* Hit target: the whole month column */}
                    <rect
                      x={pad.l + slot * i}
                      y={pad.t}
                      width={slot}
                      height={H - pad.t - pad.b}
                      fill="transparent"
                      tabIndex={0}
                      aria-label={`${formatMonth(d.month)}: masuk ${formatIDR(d.income)}, keluar ${formatIDR(d.expense)}`}
                      onPointerEnter={() => setHover(i)}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                    />
                  </g>
                );
              })}
            </svg>
            {hover !== null && (
              <Tooltip leftPct={((pad.l + slot * hover + slot / 2) / W) * 100}>
                <p className="text-xs font-semibold capitalize text-slate-500">{formatMonth(data[hover].month)}</p>
                <TipRow colour={INCOME} label="Masuk" value={data[hover].income} />
                <TipRow colour={EXPENSE} label="Keluar" value={data[hover].expense} />
              </Tooltip>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Where the money went this month (single series → one hue, sorted bars)
// ---------------------------------------------------------------------------
function CategoryChart() {
  const { dompet, me } = useCurrent();
  const [month, setMonth] = useState(currentMonth());
  const rows = q.spendingByCategory(dompet.id, me.id, month);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card
      title="Ke mana uangnya?"
      action={
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
          <button aria-label="Bulan sebelumnya" className="rounded-full px-2 py-1 hover:bg-slate-100" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹
          </button>
          <span className="capitalize">{formatMonth(month)}</span>
          <button aria-label="Bulan berikutnya" disabled={month === currentMonth()} className="rounded-full px-2 py-1 hover:bg-slate-100 disabled:opacity-30" onClick={() => setMonth(shiftMonth(month, 1))}>
            ›
          </button>
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Belum ada pengeluaran.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id ?? "none"} title={`${r.name}: ${formatIDR(r.total)}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-700">
                  <Icon value={r.icon} size={18} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="num shrink-0 text-slate-600">
                  {formatCompact(r.total)} <span className="text-xs text-slate-400">· {Math.round((r.total / total) * 100)}%</span>
                </span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-slate-100">
                <div className="h-2.5 rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: EXPENSE }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart chrome
// ---------------------------------------------------------------------------
function Legend({ items }: { items: { label: string; colour: string; shape: "line" | "dash" | "rect" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <svg width={18} height={10} aria-hidden>
            {it.shape === "rect" ? (
              <rect x={4} y={0} width={10} height={10} rx={2} fill={it.colour} />
            ) : (
              <line x1={1} x2={17} y1={5} y2={5} stroke={it.colour} strokeWidth={2} strokeDasharray={it.shape === "dash" ? "4 3" : undefined} />
            )}
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ leftPct, children }: { leftPct: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-2xl bg-white px-3 py-2 shadow-[0_8px_24px_-8px_rgba(120,72,40,0.35)]"
      style={{ left: `${leftPct}%`, transform: `translateX(${leftPct > 60 ? "-105%" : "5%"})` }}
    >
      {children}
    </div>
  );
}

function TipRow({ colour, label, value, dashed }: { colour: string; label: string; value: number; dashed?: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <svg width={14} height={6} aria-hidden>
        <line x1={0} x2={14} y1={3} y2={3} stroke={colour} strokeWidth={2} strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      <span className="num font-bold text-slate-800">{formatIDR(Math.round(value))}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Net worth summary (full page: Neraca)
// ---------------------------------------------------------------------------
function NetWorthCard() {
  const { dompet, me } = useCurrent();
  const nw = netWorth(dompet.id, me.id);
  const trend = netWorthTrend(dompet.id, me.id, 2);
  const delta = nw.net - trend[0].net;
  return (
    <a href="#/neraca" className="block">
      <Card title="Kekayaan bersih ⚖️" action={<span className="text-sm font-semibold text-brand-700">Neraca →</span>}>
        <p className="num text-2xl font-extrabold text-slate-800">{formatIDR(nw.net)}</p>
        <p className="mt-0.5 text-sm text-slate-500">
          Harta {formatCompact(nw.totalAssets)} − Utang {formatCompact(nw.totalLiabilities)}
          {delta !== 0 && (
            <span className={delta > 0 ? "font-semibold text-mint-600" : "font-semibold text-red-600"}>
              {" "}
              · {delta > 0 ? "▲" : "▼"} {formatCompact(Math.abs(delta))} sejak akhir {formatMonth(trend[0].month).split(" ")[0]}
            </span>
          )}
        </p>
      </Card>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Kebutuhan vs keinginan (only once something is tagged)
// ---------------------------------------------------------------------------
function NeedWantCard() {
  const { dompet, me } = useCurrent();
  const month = currentMonth();
  const r = q.needWant(dompet.id, me.id, month);
  const tagged = r.need + r.want;
  if (tagged === 0) return null;
  const wantPct = Math.round((r.want / tagged) * 100);
  return (
    <Card title="Kebutuhan vs keinginan">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Kebutuhan ${formatIDR(r.need)}, keinginan ${formatIDR(r.want)}`}>
        <div className="h-full rounded-l-full" style={{ width: `${100 - wantPct}%`, background: "var(--color-brand-500)" }} />
        <div className="h-full rounded-r-full" style={{ width: `${wantPct}%`, background: "var(--color-lilac-600)" }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <p>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-brand-500)" }} />
          🧺 Kebutuhan <b className="num block text-slate-800">{formatIDR(r.need)}</b>
        </p>
        <p>
          <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-lilac-600)" }} />
          🎁 Keinginan <b className="num block text-slate-800">{formatIDR(r.want)}</b>
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {wantPct}% dari belanja yang ditandai bulan ini untuk keinginan.
        {r.untagged > 0 && ` ${formatCompact(r.untagged)} belum ditandai.`}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Arus kas: income vs spending, other money moves, and balances that close
// ---------------------------------------------------------------------------
function CashFlowCard() {
  const { dompet, me } = useCurrent();
  const [mode, setMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(currentMonth());
  const year = Number(month.slice(0, 4));
  const range =
    mode === "month"
      ? periodRange(month)
      : { from: periodRange(`${year}-01`).from, to: periodRange(`${year}-12`).to };
  const cf = cashFlow(dompet.id, me.id, range.from, range.to);
  const net = cf.income - cf.expense;
  const isLast = mode === "month" ? month >= currentMonth() : year >= Number(currentMonth().slice(0, 4));
  const step = (d: number) => setMonth(shiftMonth(month, mode === "month" ? d : d * 12));
  const label = mode === "month" ? formatMonth(month) : `Tahun ${year}`;
  const sign = (v: number) => (v > 0 ? `+${formatIDR(v)}` : v < 0 ? `−${formatIDR(-v)}` : formatIDR(0));
  const Line = ({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) => (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className={strong ? "font-bold text-slate-800" : "text-slate-600"}>
        {label}
        {hint && <span className="block text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      <span className={`num shrink-0 ${strong ? "font-extrabold text-slate-800" : "font-semibold text-slate-700"}`}>{value}</span>
    </li>
  );
  const others = [
    cf.newAccounts !== 0 && { label: "Saldo awal akun baru", hint: "uang lama yang baru dicatat", v: cf.newAccounts },
    cf.adjustments !== 0 && { label: "Koreksi saldo", hint: "menyamakan saldo dengan kenyataan", v: cf.adjustments },
    cf.loans !== 0 && { label: "Pinjaman (bersih)", hint: "dipinjamkan, dipinjam, dan cicilannya", v: cf.loans },
    cf.transfers !== 0 && { label: "Transfer ke akun yang tidak terlihat", hint: "mis. ke akun pribadi anggota lain", v: cf.transfers },
  ].filter(Boolean) as { label: string; hint: string; v: number }[];

  return (
    <Card title="Arus kas 💧">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-2 gap-0.5 rounded-full bg-slate-100 p-0.5 text-xs font-bold">
          {(
            [
              ["month", "Bulanan"],
              ["year", "Tahunan"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`rounded-full px-3 py-1.5 ${mode === k ? "bg-slate-800 text-white" : "text-slate-500"}`}>
              {l}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
          <button aria-label="Sebelumnya" className="rounded-full px-2 py-1 hover:bg-slate-100" onClick={() => step(-1)}>
            ‹
          </button>
          <span className="text-center capitalize leading-tight">
            {label}
            {mode === "month" && formatPeriodRange(month) && <span className="block text-[10px] font-normal normal-case">{formatPeriodRange(month)}</span>}
          </span>
          <button aria-label="Berikutnya" disabled={isLast} className="rounded-full px-2 py-1 hover:bg-slate-100 disabled:opacity-30" onClick={() => step(1)}>
            ›
          </button>
        </span>
      </div>

      <ul className="divide-y divide-slate-100 text-sm">
        <Line label="Uang masuk" hint="pemasukan dari kategori" value={`+${formatIDR(cf.income)}`} />
        <Line label="Uang keluar" hint="semua belanja & tagihan" value={`−${formatIDR(cf.expense)}`} />
        <Line label="Arus kas bersih" hint={net >= 0 ? "uang bebas yang tersisa" : "lebih banyak keluar dari masuk"} value={sign(net)} strong />
      </ul>

      {others.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Bukan pemasukan / pengeluaran</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {others.map((o) => (
              <Line key={o.label} label={o.label} hint={o.hint} value={sign(o.v)} />
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Saldo semua akun</p>
      <ul className="divide-y divide-slate-100 text-sm">
        <Line label="Awal periode" value={formatIDR(cf.startBalance)} />
        <Line label="Akhir periode" value={formatIDR(cf.endBalance)} />
        <Line label="Berubah" value={sign(cf.endBalance - cf.startBalance)} strong />
      </ul>
      <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-semibold ${Math.abs(cf.gap) <= 1 ? "bg-mint-100 text-mint-600" : "bg-amber-50 text-amber-800"}`}>
        {Math.abs(cf.gap) <= 1
          ? "✓ Cocok: arus kas + pergerakan lain = perubahan saldo semua akun."
          : `Selisih ${formatIDR(cf.gap)} antara catatan dan saldo. Cek akun dengan mata uang asing atau koreksi saldo.`}
      </p>
      {range.to > todayISO() && cashFlow(dompet.id, me.id, range.from, todayISO()).endBalance !== cf.endBalance && (
        <p className="mt-2 text-xs text-slate-400">Termasuk catatan yang bertanggal nanti di periode ini, jadi saldo akhir bisa beda dengan saldo hari ini.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Balance projection: 1–12 months ahead, three spending scenarios
// ---------------------------------------------------------------------------
const SCENARIOS = [
  { key: "good", label: "Hemat", colour: "#2fb67c", text: "text-mint-700", bg: "bg-mint-100" },
  { key: "normal", label: "Normal", colour: "#4e3f33", text: "text-slate-800", bg: "bg-slate-100" },
  { key: "bad", label: "Boros", colour: "#e5484d", text: "text-red-700", bg: "bg-red-50" },
] as const;

function BalanceProjection({ f, horizon, setHorizon }: { f: ReturnType<typeof useForecast>; horizon: number; setHorizon: (h: number) => void }) {
  const [tip, setTip] = useState<number | null>(null);
  const t = f.trajectory;
  const last = t[t.length - 1];
  const s = f.scenarios;
  // Chart: point 0 = end of this month, then each month ahead.
  const series = {
    good: [s.start.good, ...t.map((x) => x.good)],
    normal: [s.start.normal, ...t.map((x) => x.balance)],
    bad: [s.start.bad, ...t.map((x) => x.bad)],
  };
  const labels = [f.month, ...t.map((x) => x.month)];
  // Zero only joins the scale when a scenario gets near it, so the spread stays visible.
  const all = [...series.good, ...series.bad];
  if (Math.min(...all) < (Math.max(...all) - Math.min(...all)) * 0.5) all.push(0);
  const hi = Math.max(...all);
  const lo = Math.min(...all);
  const pad = (hi - lo) * 0.08 || 1;
  const W = 320;
  const H = 160;
  const x = (i: number) => (labels.length === 1 ? W / 2 : (i / (labels.length - 1)) * (W - 16) + 8);
  const y = (v: number) => 8 + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - 16);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const band = `${path(series.good)} ${series.bad.map((v, i) => [x(i), y(v)] as const).reverse().map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} Z`;
  const tipIdx = tip ?? labels.length - 1;

  return (
    <Card title="Proyeksi saldo 🔮">
      <div className="rounded-2xl bg-slate-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="horizon" className="text-sm font-semibold text-slate-700">
            Lihat ke depan
          </label>
          <span className="num rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-800 shadow-sm">{horizon} bulan</span>
        </div>
        <input
          id="horizon"
          type="range"
          min={1}
          max={12}
          step={1}
          value={horizon}
          onChange={(e) => (setHorizon(Number(e.target.value)), setTip(null))}
          className="mt-2 w-full accent-brand-600"
          aria-valuetext={`${horizon} bulan`}
        />
        <div className="flex justify-between text-[10px] font-semibold text-slate-400">
          <span>1 bln</span>
          <span>6 bln</span>
          <span>1 tahun</span>
        </div>
      </div>

      {/* Where it lands at the end of the horizon, per scenario */}
      <p className="mt-3 text-xs font-semibold text-slate-500">
        Saldo akhir <span className="capitalize">{formatMonth(last.month)}</span>
      </p>
      <div className="mt-1 grid grid-cols-3 gap-2 text-center">
        {SCENARIOS.map((sc) => {
          const v = sc.key === "normal" ? last.balance : last[sc.key];
          return (
            <div key={sc.key} className={cx("rounded-2xl p-2", sc.bg)}>
              <p className={cx("text-[11px] font-semibold", sc.text)}>{sc.label}</p>
              <p className={cx("num font-extrabold", v < 0 ? "text-red-700" : "text-slate-800")}>{formatCompact(Math.round(v))}</p>
              <p className="num text-[10px] text-slate-500">belanja ±{formatCompact(Math.round(s.rates[sc.key] * 30))}/bln</p>
            </div>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 w-full touch-none"
        role="img"
        aria-label={`Proyeksi saldo ${horizon} bulan: hemat ${formatCompact(Math.round(last.good))}, normal ${formatCompact(Math.round(last.balance))}, boros ${formatCompact(Math.round(last.bad))}`}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setTip(Math.max(0, Math.min(labels.length - 1, Math.round(((px - 8) / (W - 16)) * (labels.length - 1)))));
        }}
        onPointerLeave={() => setTip(null)}
      >
        {[hi, lo].map((v) => (
          <g key={v}>
            <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={2} y={y(v) - 3} fontSize={9} fill={INK_MUTED}>
              {formatCompact(Math.round(v))}
            </text>
          </g>
        ))}
        {lo < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#e5484d" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />}
        <path d={band} fill="#b29d8b" opacity={0.12} />
        {SCENARIOS.map((sc) => (
          <path key={sc.key} d={path(series[sc.key])} fill="none" stroke={sc.colour} strokeWidth={sc.key === "normal" ? 2.5 : 1.75} strokeDasharray={sc.key === "normal" ? undefined : "5 4"} strokeLinecap="round" />
        ))}
        <line x1={x(tipIdx)} x2={x(tipIdx)} y1={4} y2={H - 4} stroke="#b29d8b" strokeWidth={1} opacity={0.5} />
        {SCENARIOS.map((sc) => (
          <circle key={sc.key} cx={x(tipIdx)} cy={y(series[sc.key][tipIdx])} r={3.5} fill={sc.colour} stroke="white" strokeWidth={1.5} />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] font-semibold capitalize text-slate-400">
        <span>akhir {shortMonth(labels[0])}</span>
        <span>{shortMonth(labels[labels.length - 1])}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl bg-slate-50 px-3 py-1.5 text-xs">
        <span className="font-semibold capitalize text-slate-700">{tipIdx === 0 ? `Akhir ${formatMonth(labels[0])}` : formatMonth(labels[tipIdx])}</span>
        <span className="num text-slate-600">
          <span className="text-mint-700">{formatCompact(Math.round(series.good[tipIdx]))}</span> ·{" "}
          <b className="text-slate-800">{formatCompact(Math.round(series.normal[tipIdx]))}</b> ·{" "}
          <span className="text-red-700">{formatCompact(Math.round(series.bad[tipIdx]))}</span>
        </span>
      </div>
      {last.bad < 0 && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
          ⚠️ Kalau belanja seperti bulan paling boros, saldo bisa minus sebelum {formatMonth(t[t.findIndex((x) => x.bad < 0)].month)}.
        </p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-brand-700">Rincian per bulan</summary>
        <ul className="mt-1 divide-y divide-slate-100">
          {t.map((m) => (
            <li key={m.month} className="py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold capitalize text-slate-800">{formatMonth(m.month)}</span>
                <span className="num font-bold text-slate-800">≈ {formatCompact(Math.round(m.balance))}</span>
              </div>
              <p className="num text-xs text-slate-500">
                masuk ≈ {formatCompact(Math.round(m.income))} · keluar ≈ {formatCompact(Math.round(m.expense))}
                {m.recurring.length > 0 && ` · ${m.recurring.length} rutin`}
              </p>
              <p className="num text-[11px] text-slate-400">
                hemat {formatCompact(Math.round(m.good))} · boros {formatCompact(Math.round(m.bad))}
              </p>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-3 rounded-2xl bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-700">Pemasukan dihitung dari</p>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-white p-1 shadow-sm" role="radiogroup" aria-label="Dasar pemasukan">
          {(
            [
              ["recurring", "Rutin saja"],
              ["recurring+avg", "Rutin + rata-rata"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="radio"
              aria-checked={f.incomeBasis === key}
              onClick={() => f.setIncomeBasis(key)}
              className={cx("rounded-full py-1.5 text-xs font-semibold transition", f.incomeBasis === key ? "bg-slate-800 text-white" : "text-slate-500")}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {f.incomeBasis === "recurring"
            ? "Hanya pemasukan dari menu Rutin (mis. Gaji) yang diperkirakan."
            : `Ditambah rata-rata pemasukan lain ${f.historyDays} hari terakhir ≈ ${formatCompact(Math.round(f.avgIncomePerMonth))}/bulan.`}
          {f.excludedIncomeCategories > 0 && " Pemasukan di kategori yang sudah ada di Rutin (mis. Gaji) tidak dihitung dua kali."}
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Semua skenario memakai tagihan & pemasukan Rutin yang sama. Bedanya di belanja harian: Normal = rata-rata {f.historyDays} hari terakhir;{" "}
        {s.fromHistory
          ? `Hemat & Boros = bulan paling hemat dan paling boros dari ${s.historyMonths} bulan terakhir.`
          : "Hemat & Boros = 15% lebih sedikit / lebih banyak (riwayat belum cukup 2 bulan penuh)."}{" "}
        Utang-piutang dan transfer tidak dihitung.
      </p>
    </Card>
  );
}
