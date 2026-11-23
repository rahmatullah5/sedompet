// Extra Laporan widgets: asset summary with profit/loss, and "porsi" pie charts.

import { useState } from "react";
import { accountTypeLabel, MARKETS, q, type Account, type Holding, type Market } from "../db/repo";
import { currentMonth, formatCompact, formatIDR, formatMonth, shiftMonth } from "../lib/format";
import { currencyInfo, formatMoney, formatRate, isBase } from "../lib/currency";
import { useCurrent } from "../lib/hooks";
import { Card, cx } from "../components/ui";
import { holdingCost, holdingValue } from "../components/StockPanel";

// Categorical order for slices (validated: lightness/chroma pass, worst
// adjacent CVD ΔE 7.4 => secondary encoding: 2px gaps + the legend list with
// names, amounts and shares). Slice 7+ folds into "Lainnya" (neutral).
const SLICES = ["#4f8ef7", "#f47c5a", "#2fb67c", "#8b74e8", "#c98a12", "#e5689b"];
const OTHER = "#b29d8b";
const GAIN = "text-mint-600";
const LOSS = "text-red-600";

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1).replace(".", ",")}%`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${formatCompact(Math.abs(Math.round(v)))}`;

// ---------------------------------------------------------------------------
// Pie (donut) with a legend list that doubles as the table view
// ---------------------------------------------------------------------------
export interface Slice {
  key: string;
  label: string;
  value: number;
  sub?: string;
}

export function PieChart({ slices, total: totalLabel, empty }: { slices: Slice[]; total?: string; empty: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = positive.length > SLICES.length + 1 ? positive.slice(0, SLICES.length) : positive.slice(0, SLICES.length + 1);
  const tail = positive.slice(head.length);
  const parts = [
    ...head.map((s, i) => ({ ...s, colour: SLICES[i] ?? OTHER })),
    ...(tail.length ? [{ key: "__other", label: `Lainnya (${tail.length})`, value: tail.reduce((a, s) => a + s.value, 0), colour: OTHER, sub: undefined }] : []),
  ];
  const total = parts.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <p className="py-4 text-center text-sm text-slate-400">{empty}</p>;

  const R = 70;
  const r = 44;
  const C = 80;
  let angle = -Math.PI / 2;
  const arcs = parts.map((p) => {
    const sweep = (p.value / total) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    return { ...p, a0, a1: angle, sweep };
  });
  const pt = (rad: number, a: number) => `${(C + rad * Math.cos(a)).toFixed(2)},${(C + rad * Math.sin(a)).toFixed(2)}`;
  const arcPath = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(R, a0)}A${R},${R} 0 ${large} 1 ${pt(R, a1)}L${pt(r, a1)}A${r},${r} 0 ${large} 0 ${pt(r, a0)}Z`;
  };
  const focus = arcs.find((a) => a.key === hover);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <svg viewBox="0 0 160 160" className="w-40 shrink-0" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {arcs.length === 1 ? (
          <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={arcs[0].colour} strokeWidth={R - r} />
        ) : (
          arcs.map((a) => (
            <path
              key={a.key}
              d={arcPath(a.a0, a.a1)}
              fill={a.colour}
              stroke="#fff"
              strokeWidth={2}
              strokeLinejoin="round"
              opacity={hover && hover !== a.key ? 0.4 : 1}
              onPointerEnter={() => setHover(a.key)}
              onPointerLeave={() => setHover(null)}
            />
          ))
        )}
        <text x={C} y={C - 4} textAnchor="middle" fontSize={11} fill="#8a7563">
          {focus ? `${Math.round((focus.value / total) * 100)}%` : (totalLabel ?? "Total")}
        </text>
        <text x={C} y={C + 13} textAnchor="middle" fontSize={15} fontWeight={800} fill="#4e3f33">
          {formatCompact(Math.round(focus ? focus.value : total))}
        </text>
      </svg>
      <ul className="w-full min-w-0 flex-1 space-y-1">
        {arcs.map((a) => (
          <li
            key={a.key}
            className={cx("flex items-center gap-2 rounded-xl px-2 py-1 text-sm", hover === a.key && "bg-slate-50")}
            onPointerEnter={() => setHover(a.key)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.colour }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-700">{a.label}</span>
              {a.sub && <span className="block truncate text-[11px] text-slate-400">{a.sub}</span>}
            </span>
            <span className="num shrink-0 text-right">
              <span className="font-semibold text-slate-700">{formatCompact(Math.round(a.value))}</span>
              <span className="block text-[11px] text-slate-400">{Math.round((a.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tabs<K extends string>({ value, options, onChange }: { value: K; options: [K, string][]; onChange: (k: K) => void }) {
  return (
    <div className="mb-3 flex w-fit gap-0.5 rounded-full bg-slate-100 p-0.5 text-xs font-bold">
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} className={cx("rounded-full px-3 py-1.5", value === k ? "bg-slate-800 text-white" : "text-slate-500")}>
          {l}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset summary: every account grouped by asset class or by account type,
// with value and profit/loss of investments
// ---------------------------------------------------------------------------
interface Bucket {
  key: string;
  label: string;
  value: number;
  /** Cost of investments in this bucket (rupiah); null = no investments. */
  cost: number | null;
  /** Market value of those investments (rupiah). */
  invested?: number;
  sub?: string;
  items?: { label: string; value: number }[];
}

const MARKET_ORDER: Market[] = ["IDX", "US", "CRYPTO", "GOLD"];

/** Cash part of an account in rupiah (balance_base also holds its investments). */
const cashOf = (a: Account) => a.balance_base - a.holdings_value;

function byAssetClass(accounts: Account[], holdings: Holding[]): Bucket[] {
  const out: Bucket[] = [];
  const rupiah = accounts.filter((a) => isBase(a.currency) && cashOf(a) > 0);
  if (rupiah.length) out.push({ key: "idr", label: "Kas & tabungan rupiah", value: rupiah.reduce((s, a) => s + cashOf(a), 0), cost: null, sub: `${rupiah.length} akun` });
  // Foreign currencies, one row each
  const codes = [...new Set(accounts.filter((a) => !isBase(a.currency) && a.balance > 0).map((a) => a.currency))];
  for (const code of codes) {
    const accs = accounts.filter((a) => a.currency === code && a.balance > 0);
    const native = accs.reduce((s, a) => s + a.balance, 0);
    const info = currencyInfo(code);
    out.push({
      key: `fx:${code}`,
      label: `Valas ${code}${info.name ? ` · ${info.name}` : ""}`,
      value: accs.reduce((s, a) => s + cashOf(a), 0),
      cost: null,
      sub: `${formatMoney(native, code)} · kurs ${formatRate(accs[0].fx_rate)}`,
    });
  }
  for (const mk of MARKET_ORDER) {
    const hs = holdings.filter((h) => h.market === mk);
    if (!hs.length) continue;
    const value = hs.reduce((s, h) => s + holdingValue(h), 0);
    out.push({
      key: `mk:${mk}`,
      label: MARKETS[mk].label,
      value,
      invested: value,
      cost: hs.reduce((s, h) => s + holdingCost(h), 0),
      items: hs
        .map((h) => ({ label: h.market === "GOLD" ? "Emas" : h.symbol, value: holdingValue(h), cost: holdingCost(h) }))
        .sort((a, b) => b.value - a.value)
        .map((x) => ({ label: `${x.label} ${signed(x.value - x.cost)}`, value: x.value })),
    });
  }
  const debt = accounts.filter((a) => cashOf(a) < 0);
  if (debt.length) out.push({ key: "debt", label: "Saldo minus (kartu kredit, dll.)", value: debt.reduce((s, a) => s + cashOf(a), 0), cost: null, sub: debt.map((a) => a.name).join(", ") });
  return out;
}

function byAccountType(accounts: Account[], holdings: Holding[]): Bucket[] {
  const parentOf = new Map(accounts.map((a) => [a.id, a]));
  const typeOf = (a: Account) => accountTypeLabel((a.parent_id ? parentOf.get(a.parent_id) : null)?.type ?? a.type);
  const groups = new Map<string, Account[]>();
  for (const a of accounts) groups.set(typeOf(a), [...(groups.get(typeOf(a)) ?? []), a]);
  return [...groups.entries()]
    .map(([type, accs]): Bucket => {
      const ids = new Set(accs.map((a) => a.id));
      const hs = holdings.filter((h) => ids.has(h.account_id));
      // Pockets roll up into their main account's line.
      const lines = new Map<string, number>();
      for (const a of accs) {
        const main = a.parent_id ? (parentOf.get(a.parent_id)?.name ?? a.name) : a.name;
        lines.set(main, (lines.get(main) ?? 0) + a.balance_base);
      }
      const invested = hs.reduce((s, h) => s + holdingValue(h), 0);
      return {
        key: `type:${type}`,
        label: type,
        value: accs.reduce((s, a) => s + a.balance_base, 0),
        cost: hs.length ? hs.reduce((s, h) => s + holdingCost(h), 0) : null,
        invested,
        sub: hs.length ? `investasi ${formatCompact(invested)}` : undefined,
        items: [...lines.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
      };
    })
    .sort((a, b) => b.value - a.value);
}

export function AssetSummaryCard() {
  const { dompet, me } = useCurrent();
  const [view, setView] = useState<"class" | "type">("class");
  const [open, setOpen] = useState<string | null>(null);
  const accounts = q.accounts(dompet.id, me.id);
  const holdings = q.holdings(dompet.id, me.id);
  if (!accounts.length) return null;
  const buckets = view === "class" ? byAssetClass(accounts, holdings) : byAccountType(accounts, holdings);
  const total = accounts.reduce((s, a) => s + a.balance_base, 0);
  const invValue = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const invCost = holdings.reduce((s, h) => s + holdingCost(h), 0);
  const gain = invValue - invCost;

  return (
    <Card title="Ringkasan aset">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-500">Total semua akun</p>
          <p className="num text-xl font-extrabold text-slate-800">{formatCompact(Math.round(total))}</p>
        </div>
        {holdings.length > 0 && (
          <div>
            <p className="text-xs text-slate-500">Untung/rugi investasi</p>
            <p className={cx("num text-xl font-extrabold", gain >= 0 ? GAIN : LOSS)}>{signed(gain)}</p>
            {invCost > 0 && <p className={cx("num text-xs font-semibold", gain >= 0 ? GAIN : LOSS)}>{pct((gain / invCost) * 100)} dari modal {formatCompact(invCost)}</p>}
          </div>
        )}
      </div>
      <div className="mt-3">
        <Tabs
          value={view}
          onChange={(v) => (setView(v), setOpen(null))}
          options={[
            ["class", "Per jenis aset"],
            ["type", "Per tipe akun"],
          ]}
        />
      </div>
      <ul className="divide-y divide-slate-100">
        {buckets.map((b) => {
          const g = b.cost !== null ? (b.invested ?? 0) - b.cost : null;
          const expandable = !!b.items?.length;
          return (
            <li key={b.key} className="py-2">
              <button
                type="button"
                disabled={!expandable}
                aria-expanded={expandable ? open === b.key : undefined}
                onClick={() => setOpen(open === b.key ? null : b.key)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-700">{b.label}</span>
                  {b.sub && <span className="block truncate text-xs text-slate-400">{b.sub}</span>}
                  {b.cost !== null && b.cost > 0 && <span className="num block text-xs text-slate-400">modal {formatCompact(b.cost)}</span>}
                </span>
                <span className="num shrink-0 text-right">
                  <span className={cx("block font-bold", b.value < 0 ? LOSS : "text-slate-800")}>{formatIDR(Math.round(b.value))}</span>
                  {g !== null && (
                    <span className={cx("block text-xs font-semibold", g >= 0 ? GAIN : LOSS)}>
                      {signed(g)}
                      {b.cost ? ` (${pct((g / b.cost) * 100)})` : ""}
                    </span>
                  )}
                  {total > 0 && b.value > 0 && <span className="block text-[11px] text-slate-400">{Math.round((b.value / total) * 100)}% dari total</span>}
                </span>
              </button>
              {open === b.key && b.items && (
                <ul className="mt-1.5 space-y-0.5 rounded-xl bg-slate-50 px-3 py-2">
                  {b.items.map((it) => (
                    <li key={it.label} className="flex justify-between gap-2 text-xs">
                      <span className="truncate text-slate-600">{it.label}</span>
                      <span className="num shrink-0 font-semibold text-slate-700">{formatIDR(Math.round(it.value))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {holdings.some((h) => !h.price) && <p className="mt-2 text-xs text-amber-700">Sebagian harga belum terambil; nilainya memakai harga beli rata-rata.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pie widgets
// ---------------------------------------------------------------------------
export function AccountPieCard() {
  const { dompet, me } = useCurrent();
  const [view, setView] = useState<"account" | "type" | "class">("account");
  const accounts = q.accounts(dompet.id, me.id);
  const holdings = q.holdings(dompet.id, me.id);
  const parentOf = new Map(accounts.map((a) => [a.id, a]));
  let slices: Slice[];
  if (view === "account") {
    const m = new Map<string, Slice>();
    for (const a of accounts) {
      const main = a.parent_id ? (parentOf.get(a.parent_id) ?? a) : a;
      const s = m.get(main.id) ?? { key: main.id, label: main.name, value: 0, sub: accountTypeLabel(main.type) };
      s.value += a.balance_base;
      m.set(main.id, s);
    }
    slices = [...m.values()];
  } else {
    const buckets = view === "type" ? byAccountType(accounts, holdings) : byAssetClass(accounts, holdings);
    slices = buckets.map((b) => ({ key: b.key, label: b.label, value: b.value }));
  }
  const negative = slices.filter((s) => s.value < 0).reduce((a, s) => a + s.value, 0);
  return (
    <Card title="Porsi saldo">
      <Tabs
        value={view}
        onChange={setView}
        options={[
          ["account", "Akun"],
          ["type", "Tipe akun"],
          ["class", "Jenis aset"],
        ]}
      />
      <PieChart slices={slices} empty="Belum ada saldo." />
      {negative < 0 && <p className="mt-2 text-xs text-slate-400">Saldo minus ({formatIDR(Math.round(negative))}) tidak masuk grafik.</p>}
    </Card>
  );
}

export function InvestmentPieCard() {
  const { dompet, me } = useCurrent();
  const [view, setView] = useState<"asset" | "market">("asset");
  const holdings = q.holdings(dompet.id, me.id);
  const slices: Slice[] =
    view === "asset"
      ? holdings.map((h) => {
          const v = holdingValue(h);
          const c = holdingCost(h);
          return { key: h.id, label: h.market === "GOLD" ? "Emas" : h.symbol, value: v, sub: `${MARKETS[h.market].label} · ${signed(v - c)}` };
        })
      : MARKET_ORDER.map((mk) => {
          const hs = holdings.filter((h) => h.market === mk);
          const v = hs.reduce((s, h) => s + holdingValue(h), 0);
          return { key: mk, label: MARKETS[mk].label, value: v, sub: hs.length ? `${hs.length} aset · ${signed(v - hs.reduce((s, h) => s + holdingCost(h), 0))}` : undefined };
        });
  return (
    <Card title="Porsi investasi">
      <Tabs
        value={view}
        onChange={setView}
        options={[
          ["asset", "Per aset"],
          ["market", "Per pasar"],
        ]}
      />
      <PieChart slices={slices} empty="Belum ada saham, kripto atau emas." />
    </Card>
  );
}

export function BudgetPieCard() {
  const { dompet } = useCurrent();
  const [view, setView] = useState<"spent" | "limit">("spent");
  const month = currentMonth();
  const budgets = q.budgets(dompet.id, month, { wholeMonth: true });
  const slices: Slice[] = budgets.map((b) => ({
    key: b.id,
    label: b.name,
    value: view === "spent" ? b.spent : b.limit,
    sub: view === "spent" ? `${Math.round((b.spent / Math.max(1, b.limit)) * 100)}% dari ${formatCompact(b.limit)}` : `terpakai ${formatCompact(b.spent)}`,
  }));
  return (
    <Card title={`Porsi anggaran · ${formatMonth(month).split(" ")[0]}`}>
      <Tabs
        value={view}
        onChange={setView}
        options={[
          ["spent", "Terpakai"],
          ["limit", "Batas"],
        ]}
      />
      <PieChart slices={slices} total={view === "spent" ? "Terpakai" : "Batas"} empty={budgets.length ? "Belum ada belanja di anggaran bulan ini." : "Belum ada anggaran."} />
    </Card>
  );
}

export function CategoryPieCard() {
  const { dompet, me } = useCurrent();
  const [month, setMonth] = useState(currentMonth());
  const rows = q.spendingByCategory(dompet.id, me.id, month);
  return (
    <Card
      title="Porsi pengeluaran"
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
      <PieChart slices={rows.map((r) => ({ key: r.id ?? "none", label: r.name, value: r.total }))} total="Keluar" empty="Belum ada pengeluaran." />
    </Card>
  );
}
