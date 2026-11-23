import { useState } from "react";
import { budgetCovers, parseSplit, q, type Kind, type Transaction, isInvestmentMove } from "../db/repo";
import { currentMonth, formatDay, formatIDR, formatMonth, formatPeriodRange, periodRange, shiftMonth, toISODate, todayISO } from "../lib/format";
import { DatePicker } from "../components/DatePicker";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Avatar, Badge, Button, Card, Empty, Money } from "../components/ui";
import { Icon } from "../components/Icon";
import { LineIcon } from "../components/LineIcon";
import { MultiAccountPicker, MultiCategoryPicker } from "../components/Pickers";
import { SpendingCalendar, type DayFlow } from "../components/SpendingCalendar";

export function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_4px_14px_-8px_rgba(120,72,40,0.35)]">
      <Button variant="ghost" className="px-3" aria-label="Bulan sebelumnya" onClick={() => setMonth(shiftMonth(month, -1))}>
        ‹
      </Button>
      <span className="min-w-32 text-center text-sm font-bold capitalize leading-tight">
        {formatMonth(month)}
        {formatPeriodRange(month) && <span className="block text-[11px] font-semibold normal-case text-slate-400">{formatPeriodRange(month)}</span>}
      </span>
      <Button variant="ghost" className="px-3" aria-label="Bulan berikutnya" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>
        ›
      </Button>
    </div>
  );
}

export function TxRow({ t, onClick, showDate }: { t: Transaction; onClick: () => void; showDate?: boolean }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-slate-50">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
          style={{ background: `${t.category_colour ?? "#94a3b8"}22` }}
        >
          <Icon value={t.flag === "transfer" ? "🔁" : t.flag === "adjustment" ? "⚖️" : t.flag === "loan" && !t.category_icon ? "🤝" : t.category_icon} size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-800">
            {t.note || t.category_name || (t.flag === "transfer" ? "Transfer" : t.flag === "adjustment" ? "Koreksi saldo" : "Tanpa kategori")}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
            {showDate && (
              <>
                <span className="font-semibold capitalize text-slate-600">{formatDay(t.date)}</span>
                <span>·</span>
              </>
            )}
            {t.paid_by_emoji && <Avatar emoji={t.paid_by_emoji} colour={t.paid_by_colour ?? "#94a3b8"} size={16} />}
            <span>{t.paid_by_name ?? "—"}</span>
            <span>·</span>
            <span className="truncate">
              {t.account_visibility === "private" && <LineIcon name="lock" size={11} className="mr-0.5 inline -mt-0.5" />}
              {t.account_name}
              {t.note && t.category_name && ` · ${t.parent_category_name ? `${t.parent_category_name} › ` : ""}${t.category_name}`}
              {t.merchant && ` · ${t.merchant}`}
            </span>
            {t.date > todayISO() && <span className="rounded-full bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700">nanti</span>}
            {t.receipt && <span title="Ada foto nota"><LineIcon name="receipt" size={12} /></span>}
            {t.need === "want" && <span className="rounded-full bg-lilac-100 px-1.5 text-[10px] font-semibold text-lilac-600">keinginan</span>}
            {t.split_with && t.flag === "transfer" ? (
              <span className="rounded-full bg-mint-100 px-1.5 text-[10px] font-semibold text-mint-600">lunas patungan</span>
            ) : (
              t.flag && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{t.flag === "transfer" ? "transfer" : t.flag === "loan" ? "pinjaman" : isInvestmentMove(t.note) ? "investasi" : "koreksi"}</span>
            )}
            {t.split_with && !t.flag && (
              <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700">dibagi {parseSplit(t.split_with)?.length ?? ""}</span>
            )}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <Money amount={t.amount} kind={t.kind} currency={t.account_currency} className="text-sm" />
          {t.account_currency !== "IDR" && <span className="num text-[11px] text-slate-400">≈ {formatIDR(t.amount_base)}</span>}
        </span>
      </button>
    </li>
  );
}

type SortKey = "newest" | "oldest" | "largest" | "smallest";
const TRANSFER_KEY = "sedompet.riwayat.showTransfers";
const SORTS: [SortKey, string][] = [
  ["newest", "Terbaru"],
  ["oldest", "Terlama"],
  ["largest", "Terbesar"],
  ["smallest", "Terkecil"],
];
const SORT_KEY = "sedompet.riwayat.sort";
function loadSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return SORTS.some(([k]) => k === v) ? (v as SortKey) : "newest";
  } catch {
    return "newest";
  }
}

const CAL_KEY = "sedompet.riwayat.calendar";

export function Transactions({
  onOpenTx,
  onAddOnDate,
  onBulk,
}: {
  onOpenTx: (t: Transaction) => void;
  onAddOnDate?: (iso: string) => void;
  onBulk?: () => void;
}) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const [month, setMonthState] = useState(currentMonth());
  const [day, setDay] = useState<string | null>(null);
  const setMonth = (m: string) => {
    setMonthState(m);
    setDay(null);
  };
  const [showCal, setShowCalState] = useState(() => {
    try {
      return localStorage.getItem(CAL_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleCal = () => {
    setShowCalState((v) => {
      try {
        localStorage.setItem(CAL_KEY, v ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !v;
    });
    setDay(null);
  };
  const [paidByIds, setPaidByIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [kind, setKind] = useState<"" | Kind>("");
  const [budgetId, setBudgetId] = useState<string | null>(null);
  // Transfers between own accounts are hidden by default: Riwayat shows real
  // income and spending first. Remembered on this device.
  const [showTransfers, setShowTransfersState] = useState(() => {
    try {
      return localStorage.getItem(TRANSFER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setShowTransfers = (v: boolean) => {
    setShowTransfersState(v);
    try {
      localStorage.setItem(TRANSFER_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };
  // Date range instead of one month at a time (null = month view).
  const [range, setRangeState] = useState<{ from: string; to: string } | null>(null);
  const setRange = (r: { from: string; to: string } | null) => {
    setRangeState(r && r.from > r.to ? { from: r.to, to: r.from } : r);
    setDay(null);
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (categoryIds.length ? 1 : 0) + (accountIds.length ? 1 : 0) + (budgetId ? 1 : 0);
  const resetFilters = () => {
    setCategoryIds([]);
    setAccountIds([]);
    setBudgetId(null);
  };
  const [sort, setSortState] = useState<SortKey>(loadSort);
  const setSort = (k: SortKey) => {
    setSortState(k);
    try {
      localStorage.setItem(SORT_KEY, k);
    } catch {
      /* ignore */
    }
  };
  const [search, setSearch] = useState("");
  const searching = search.trim().length > 0;

  const categories = q.categories(dompet.id);
  const accounts = q.accounts(dompet.id, me.id);
  const budgets = q.budgets(dompet.id, month);
  const budget = budgets.find((b) => b.id === budgetId) ?? null;
  const parentOf = new Map(categories.map((c) => [c.id, c.parent_id]));
  const allTxs = q.transactions(dompet.id, me.id, {
    // Searching looks through every month, not just the one shown.
    month: searching || range ? undefined : month,
    range: searching ? undefined : (range ?? undefined),
    search: searching ? search : undefined,
    limit: searching ? 300 : undefined,
    paidByIds,
    categoryIds,
    accountIds,
    kind: kind || undefined,
  });
  // A budget counts everyday spending from shared accounts in its categories
  // (and by its member, for allowances), the same way the Anggaran page does.
  // One transfer = two entries (out and in); count transfers, not entries.
  const transferCount = budget || showTransfers ? 0 : new Set(allTxs.filter((t) => t.flag === "transfer").map((t) => t.transfer_id ?? t.id)).size;
  const txs = budget
    ? allTxs.filter(
        (t) =>
          t.kind === "expense" &&
          !t.flag &&
          t.account_visibility === "shared" &&
          budgetCovers(budget, t.category_id, t.category_id ? (parentOf.get(t.category_id) ?? null) : null, t.paid_by),
      )
    : showTransfers
      ? allTxs
      : allTxs.filter((t) => t.flag !== "transfer");
  // Like Laporan: transfers, balance corrections and loans move money between
  // pockets, they aren't income or spending.
  const real = txs.filter((t) => !t.flag);
  const income = real.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount_base, 0);
  const expense = real.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount_base, 0);

  // Query order is newest first. By amount: one flat list (rupiah value, so
  // other currencies compare fairly); by date: grouped per day.
  const byAmount = sort === "largest" || sort === "smallest";
  const sorted =
    sort === "oldest"
      ? [...txs].reverse()
      : byAmount
        ? [...txs].sort((a, b) => (sort === "largest" ? b.amount_base - a.amount_base : a.amount_base - b.amount_base))
        : txs;
  // Calendar: everyday income and spending per date, following the filters above.
  const dayTotals = new Map<string, DayFlow>();
  for (const t of real) {
    const f = dayTotals.get(t.date) ?? { in: 0, out: 0 };
    if (t.kind === "income") f.in += t.amount_base;
    else f.out += t.amount_base;
    dayTotals.set(t.date, f);
  }
  const dayFilter = !searching && !range && day;
  const shown = dayFilter ? sorted.filter((t) => t.date === day) : sorted;
  const groups = new Map<string, Transaction[]>();
  for (const t of shown) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  const filtered = paidByIds.length > 0 || activeFilters > 0 || kind !== "" || searching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Riwayat</h1>
          <p className="text-sm text-slate-500">Semua catatan keluarga, siapa pun yang mencatat.</p>
        </div>
        {!searching && (
          <div className="flex flex-col items-end gap-1">
            {range ? (
              <button type="button" onClick={() => setRange(null)} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                ‹ Per bulan
              </button>
            ) : (
              <MonthNav month={month} setMonth={setMonth} />
            )}
            {!range && (
              <button type="button" onClick={() => setRange(periodRange(month))} className="px-2 text-xs font-semibold text-brand-700">
                Pilih rentang tanggal
              </button>
            )}
          </div>
        )}
      </div>
      {!searching && range && <RangeBar range={range} setRange={setRange} />}
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
          <LineIcon name="search" size={18} />
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari catatan, kategori, akun, nama, atau jumlah…"
          aria-label="Cari transaksi"
          className="w-full rounded-full border-2 border-transparent bg-white py-3 pl-11 pr-11 text-[15px] shadow-[0_4px_14px_-8px_rgba(120,72,40,0.35)] outline-none transition focus:border-brand-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {searching && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Hapus pencarian"
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
          >
            ✕
          </button>
        )}
      </div>
      {searching && (
        <p className="-mt-1 px-1 text-sm text-slate-500">
          {txs.length >= 300 ? "300+ hasil" : `${txs.length} hasil`} di semua bulan
          {txs.length > 0 && (
            <>
              {" "}
              · keluar <b className="num text-slate-700">{formatIDR(expense)}</b> · masuk <b className="num text-slate-700">{formatIDR(income)}</b>
            </>
          )}
        </p>
      )}
      <div className={`flex flex-wrap gap-2 text-sm ${searching ? "hidden" : ""}`}>
        <Badge tone="brand">Masuk {formatIDR(income)}</Badge>
        <Badge>Keluar {formatIDR(expense)}</Badge>
        {onBulk && (
          <button type="button" onClick={onBulk} className="ml-auto text-sm font-semibold text-brand-700">
            Catat banyak
          </button>
        )}
        {!range && (
          <button type="button" onClick={toggleCal} aria-pressed={showCal} className={`${onBulk ? "" : "ml-auto "}text-sm font-semibold text-brand-700`}>
            {showCal ? "Sembunyikan kalender" : "Kalender masuk-keluar"}
          </button>
        )}
      </div>
      {budget && !searching && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-sun-100 px-3 py-2 text-sm">
          <span className="font-semibold text-slate-800">{budget.name}</span>
          <span className="text-slate-600">
            · {txs.length} transaksi · keluar <b className="num">{formatIDR(expense)}</b>
            {!range && <> dari {formatIDR(budget.limit)}</>}
          </span>
          <button type="button" onClick={() => setBudgetId(null)} className="ml-auto font-semibold text-slate-500 hover:underline">
            ✕ Lepas
          </button>
        </div>
      )}
      {!searching && !range && showCal && (
        <Card className="pop-in p-3 sm:p-4">
          <SpendingCalendar month={month} totals={dayTotals} selected={day} onSelect={setDay} />
        </Card>
      )}
      {dayFilter && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 px-3 py-2 text-sm">
          <span className="font-semibold capitalize text-slate-800">{formatDay(day)}</span>
          <span className="text-slate-500">
            · masuk {formatIDR(dayTotals.get(day)?.in ?? 0)} · keluar {formatIDR(dayTotals.get(day)?.out ?? 0)}
          </span>
          <button type="button" onClick={() => setDay(null)} className="font-semibold text-slate-500 hover:underline">
            ✕ Semua tanggal
          </button>
          {onAddOnDate && (
            <button type="button" onClick={() => onAddOnDate(day)} className="ml-auto rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white hover:bg-brand-700">
              + Catat di tanggal ini
            </button>
          )}
        </div>
      )}

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter anggota">
        <button
          onClick={() => setPaidByIds([])}
          aria-pressed={paidByIds.length === 0}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${paidByIds.length === 0 ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm"}`}
        >
          Semua
        </button>
        {members.map((mem) => {
          const on = paidByIds.includes(mem.id);
          return (
            <button
              key={mem.id}
              onClick={() => setPaidByIds(on ? paidByIds.filter((id) => id !== mem.id) : [...paidByIds, mem.id])}
              aria-pressed={on}
              className={`flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3.5 text-sm font-semibold transition ${on ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm"}`}
            >
              <Avatar emoji={mem.emoji} colour={mem.colour} size={26} />
              {mem.name}
            </button>
          );
        })}
      </div>

      <div className="rounded-3xl bg-white/70">
        <div className="flex flex-wrap items-center gap-2 px-1">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${activeFilters ? "bg-brand-600 text-white" : "bg-white text-slate-700 shadow-sm"}`}
          >
            Filter{activeFilters ? ` (${activeFilters})` : ""}
          </button>
          {activeFilters > 0 && (
            <button onClick={resetFilters} className="text-sm font-semibold text-slate-500 underline-offset-2 hover:underline">
              Reset
            </button>
          )}
          {!budget && (
            <button
              type="button"
              onClick={() => setShowTransfers(!showTransfers)}
              aria-pressed={showTransfers}
              title={showTransfers ? "Sembunyikan transfer antar akun" : "Tampilkan transfer antar akun"}
              className={`rounded-full px-3 py-2 text-sm font-semibold transition ${showTransfers ? "bg-slate-800 text-white" : "bg-white text-slate-500 shadow-sm"}`}
            >
              {showTransfers ? "Sembunyikan transfer" : `Tampilkan transfer${transferCount ? ` (${transferCount})` : ""}`}
            </button>
          )}
          <label className="relative flex items-center">
            <span className="sr-only">Urutkan</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`appearance-none rounded-full py-2 px-3 text-sm font-semibold shadow-sm outline-none ${sort !== "newest" ? "bg-brand-600 text-white" : "bg-white text-slate-700"}`}
            >
              {SORTS.map(([k, label]) => (
                <option key={k} value={k}>
                  ↕ {label}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto grid grid-cols-3 gap-0.5 rounded-full bg-white p-0.5 shadow-sm" role="group" aria-label="Jenis">
            {(
              [
                ["", "Semua"],
                ["expense", "Keluar"],
                ["income", "Masuk"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${kind === k ? "bg-slate-800 text-white" : "text-slate-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {filtersOpen && (
          <div className="pop-in mt-3 space-y-4 rounded-3xl bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Kategori (bisa pilih beberapa)</p>
              <MultiCategoryPicker categories={kind ? categories.filter((c) => c.kind === kind) : categories} value={categoryIds} onChange={setCategoryIds} />
            </div>
            {budgets.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-semibold text-slate-700">Anggaran</p>
                <div className="flex flex-wrap gap-1.5">
                  {budgets.map((b) => {
                    const on = b.id === budgetId;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setBudgetId(on ? null : b.id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${on ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                      >
                        {b.name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-slate-400">Menampilkan pengeluaran yang dihitung ke anggaran itu (akun bersama).</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Akun</p>
              <MultiAccountPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />
            </div>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <Card>
          <Empty icon="" title={searching ? `Tidak ada yang cocok dengan “${search.trim()}”` : dayFilter ? "Belum ada catatan di tanggal ini" : filtered ? "Tidak ada yang cocok" : range ? "Belum ada transaksi di rentang ini" : "Belum ada transaksi bulan ini"}>
            {searching ? "Coba kata lain, nama orang, atau jumlah seperti 50rb." : null}
          </Empty>
        </Card>
      ) : byAmount ? (
        <Card className="p-2 sm:p-3">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((t) => (
              <TxRow key={t.id} t={t} showDate onClick={() => onOpenTx(t)} />
            ))}
          </ul>
        </Card>
      ) : (
        [...groups.entries()].map(([date, list]) => {
          // Income minus spending only: transfers, corrections and loans just move money.
          const everyday = list.filter((t) => !t.flag);
          const dayNet = everyday.reduce((s, t) => s + (t.kind === "income" ? t.amount_base : -t.amount_base), 0);
          return (
            <Card key={date} className="p-2 sm:p-3">
              <div className="flex justify-between px-2 pb-1 text-xs font-medium text-slate-500">
                <span className="capitalize">{formatDay(date)}</span>
                {everyday.length > 0 && <span className="num">{formatIDR(dayNet)}</span>}
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((t) => (
                  <TxRow key={t.id} t={t} onClick={() => onOpenTx(t)} />
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}

/** Date range for Riwayat: quick presets plus from/to pickers. */
function RangeBar({ range, setRange }: { range: { from: string; to: string }; setRange: (r: { from: string; to: string }) => void }) {
  const today = todayISO();
  const now = new Date();
  const back = (months: number) => toISODate(new Date(now.getFullYear(), now.getMonth() - months, now.getDate() + 1));
  const presets: [string, { from: string; to: string }][] = [
    ["30 hari", { from: toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), to: today }],
    ["3 bulan", { from: back(3), to: today }],
    ["6 bulan", { from: back(6), to: today }],
    ["Tahun ini", { from: `${today.slice(0, 4)}-01-01`, to: today }],
    ["12 bulan", { from: back(12), to: today }],
  ];
  return (
    <div className="pop-in space-y-2 rounded-3xl bg-white p-3 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
        {presets.map(([label, r]) => {
          const on = r.from === range.from && r.to === range.to;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => setRange(r)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
        <DatePicker label="Dari" value={range.from} max={range.to} onChange={(from) => setRange({ ...range, from })} />
        <DatePicker label="Sampai" value={range.to} min={range.from} onChange={(to) => setRange({ ...range, to })} />
      </div>
    </div>
  );
}
