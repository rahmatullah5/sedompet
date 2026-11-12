import { useState, useSyncExternalStore } from "react";
import { q } from "../db/repo";
import { projectedRecurring, variableTotals } from "../db/money";
import { currentMonth, formatCompact, formatIDR, formatMonth, shiftMonth, toISODate, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Card, cx } from "../components/ui";
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
function useForecast() {
  const { dompet, me } = useCurrent();
  const today = todayISO();
  const now = new Date();
  const month = currentMonth();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const tomorrow = toISODate(new Date(now.getFullYear(), now.getMonth(), day + 1));

  // Typical everyday (non-recurring) spending per day, from the last 90 days.
  const from90 = toISODate(new Date(now.getFullYear(), now.getMonth(), day - 89));
  const v90 = variableTotals(dompet.id, me.id, from90, today);
  const dailyVar = v90.expense / 90;
  const [incomeBasis, setIncomeBasis] = useIncomeBasis();
  const avgIncomePerMonth = (v90.income / 90) * 30;
  // "recurring" = only registered recurring income (salary etc.) is expected.
  const dailyVarIncome = incomeBasis === "recurring" ? 0 : v90.income / 90;

  const totals = q.monthTotals(dompet.id, me.id, month);
  const restOfMonth = projectedRecurring(dompet.id, me.id, tomorrow, monthEnd);
  const remainingDays = daysInMonth - day;
  const expenseEnd = totals.expense + restOfMonth.expense + dailyVar * remainingDays;
  const incomeEnd = totals.income + restOfMonth.income + dailyVarIncome * remainingDays;

  const balanceNow = q.accounts(dompet.id, me.id).reduce((s, a) => s + a.balance, 0);
  const balanceEnd = balanceNow + (incomeEnd - totals.income) - (expenseEnd - totals.expense);

  // Next 3 months: recurring items + typical variable flow (30-day equivalents).
  const ahead = [1, 2, 3].map((i) => {
    const m = shiftMonth(month, i);
    const [y, mm] = m.split("-").map(Number);
    const last = new Date(y, mm, 0).getDate();
    const rec = projectedRecurring(dompet.id, me.id, `${m}-01`, `${m}-${String(last).padStart(2, "0")}`);
    return {
      month: m,
      income: rec.income + dailyVarIncome * last,
      expense: rec.expense + dailyVar * last,
      recurring: rec.items,
    };
  });
  let running = balanceEnd;
  const trajectory = ahead.map((a) => {
    running += a.income - a.expense;
    return { ...a, balance: running };
  });

  const overall = q.budgets(dompet.id, month).find((b) => !b.category_id && !b.member_id);
  return {
    month, day, daysInMonth, totals, dailyVar, expenseEnd, incomeEnd, balanceNow, balanceEnd, restOfMonth, trajectory, overall,
    incomeBasis, setIncomeBasis, avgIncomePerMonth, excludedIncomeCategories: v90.excludedIncomeCategories,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function Reports() {
  useDbVersion();
  const f = useForecast();
  const overBudget = f.overall && f.expenseEnd > f.overall.amount;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Laporan 📊</h1>
        <p className="text-sm text-slate-500">Ke mana uang keluarga pergi, dan perkiraan ke depan.</p>
      </div>

      {/* Forecast hero */}
      <Card className="pop-in">
        <p className="text-sm font-semibold text-slate-500">Perkiraan akhir {formatMonth(f.month)}</p>
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
        <p
          className={cx(
            "mt-4 rounded-2xl px-4 py-3 text-sm",
            overBudget ? "bg-red-50 text-red-800" : "bg-mint-100 text-slate-700",
          )}
        >
          {overBudget ? "⚠️ " : "✅ "}
          {f.overall
            ? overBudget
              ? `Dengan kebiasaan sekarang, pengeluaran bisa lewat anggaran ${formatIDR(Math.round(f.expenseEnd - f.overall.amount))}. Kurangi sekitar ${formatIDR(Math.ceil((f.expenseEnd - f.overall.amount) / Math.max(1, f.daysInMonth - f.day)))} per hari.`
              : `Diperkirakan masih di bawah anggaran ${formatCompact(f.overall.amount)}. Lanjutkan!`
            : `Rata-rata belanja harian keluarga ${formatIDR(Math.round(f.dailyVar))}. Buat anggaran "Total bulanan" supaya ada pembanding.`}
        </p>
        {f.restOfMonth.items.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Sudah termasuk {f.restOfMonth.items.length} tagihan/pemasukan rutin yang belum jatuh tempo bulan ini.
          </p>
        )}
      </Card>

      <PaceChart />
      <MonthlyChart />
      <CategoryChart />

      {/* 3-month outlook */}
      <Card title="3 bulan ke depan 🔮">
        <div className="mb-3 rounded-2xl bg-slate-50 p-3">
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
                className={cx(
                  "rounded-full py-1.5 text-xs font-semibold transition",
                  f.incomeBasis === key ? "bg-slate-800 text-white" : "text-slate-500",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {f.incomeBasis === "recurring"
              ? `Hanya pemasukan dari menu Rutin (mis. Gaji) yang diperkirakan.`
              : `Ditambah rata-rata pemasukan lain 90 hari terakhir ≈ ${formatCompact(Math.round(f.avgIncomePerMonth))}/bulan.`}
            {f.excludedIncomeCategories > 0 && " Pemasukan di kategori yang sudah ada di Rutin (mis. Gaji) tidak dihitung dua kali."}
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {f.trajectory.map((t) => (
            <li key={t.month} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold capitalize text-slate-800">{formatMonth(t.month)}</span>
                <span className="num font-bold text-slate-800">saldo ≈ {formatCompact(Math.round(t.balance))}</span>
              </div>
              <p className="num text-xs text-slate-500">
                masuk ≈ {formatCompact(Math.round(t.income))} · keluar ≈ {formatCompact(Math.round(t.expense))}
                {t.recurring.length > 0 && ` · ${t.recurring.length} rutin`}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          Perkiraan = tagihan & pemasukan rutin yang terdaftar + rata-rata belanja harian 90 hari terakhir. Utang-piutang dan transfer tidak dihitung.
        </p>
      </Card>
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

  const cumulative = (rows: { day: number; total: number }[], upto: number) => {
    const out: number[] = [];
    let s = 0;
    for (let d = 1; d <= upto; d++) {
      s += rows.find((r) => r.day === d)?.total ?? 0;
      out.push(s);
    }
    return out;
  };
  const cur = cumulative(q.dailyExpense(dompet.id, me.id, thisMonth), f.day);
  const prev = cumulative(q.dailyExpense(dompet.id, me.id, lastMonth), days);
  const end = f.expenseEnd;
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
          ...(budget ? [{ label: "Anggaran", colour: REFERENCE, shape: "dash" as const }] : []),
        ]}
      />
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
              {d}
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
            <p className="text-xs font-semibold text-slate-500">Tanggal {hovered}</p>
            {hovered <= cur.length ? (
              <TipRow colour={EXPENSE} label="Bulan ini" value={cur[hovered - 1]} />
            ) : (
              <TipRow colour={EXPENSE} dashed label="Perkiraan" value={cur.length ? cur[cur.length - 1] + ((end - cur[cur.length - 1]) * (hovered - f.day)) / Math.max(1, days - f.day) : 0} />
            )}
            <TipRow colour={REFERENCE} label={formatMonth(lastMonth).split(" ")[0]} value={prev[hovered - 1] ?? 0} />
            {budget && <TipRow colour={REFERENCE} dashed label="Anggaran" value={budget} />}
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
