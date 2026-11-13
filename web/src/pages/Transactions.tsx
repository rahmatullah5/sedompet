import { useState } from "react";
import { q, type Kind, type Transaction } from "../db/repo";
import { currentMonth, formatDay, formatIDR, formatMonth, shiftMonth } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Avatar, Badge, Button, Card, Empty, Money } from "../components/ui";
import { Icon } from "../components/Icon";
import { MultiAccountPicker, MultiCategoryPicker } from "../components/Pickers";

export function MonthNav({ month, setMonth }: { month: string; setMonth: (m: string) => void }) {
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-[0_4px_14px_-8px_rgba(120,72,40,0.35)]">
      <Button variant="ghost" className="px-3" aria-label="Bulan sebelumnya" onClick={() => setMonth(shiftMonth(month, -1))}>
        ‹
      </Button>
      <span className="min-w-32 text-center text-sm font-bold capitalize">{formatMonth(month)}</span>
      <Button variant="ghost" className="px-3" aria-label="Bulan berikutnya" disabled={isCurrent} onClick={() => setMonth(shiftMonth(month, 1))}>
        ›
      </Button>
    </div>
  );
}

export function TxRow({ t, onClick }: { t: Transaction; onClick: () => void }) {
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
            {t.paid_by_emoji && <Avatar emoji={t.paid_by_emoji} colour={t.paid_by_colour ?? "#94a3b8"} size={16} />}
            <span>{t.paid_by_name ?? "—"}</span>
            <span>·</span>
            <span className="truncate">
              {t.account_visibility === "private" && "🔒 "}
              {t.account_name}
              {t.note && t.category_name && ` · ${t.parent_category_name ? `${t.parent_category_name} › ` : ""}${t.category_name}`}
            </span>
            {t.flag && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{t.flag === "transfer" ? "transfer" : t.flag === "loan" ? "pinjaman" : "koreksi"}</span>}
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

export function Transactions({ onOpenTx }: { onOpenTx: (t: Transaction) => void }) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const [month, setMonth] = useState(currentMonth());
  const [paidByIds, setPaidByIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [kind, setKind] = useState<"" | Kind>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (categoryIds.length ? 1 : 0) + (accountIds.length ? 1 : 0);
  const resetFilters = () => {
    setCategoryIds([]);
    setAccountIds([]);
  };
  const [search, setSearch] = useState("");
  const searching = search.trim().length > 0;

  const categories = q.categories(dompet.id);
  const accounts = q.accounts(dompet.id, me.id);
  const txs = q.transactions(dompet.id, me.id, {
    // Searching looks through every month, not just the one shown.
    month: searching ? undefined : month,
    search: searching ? search : undefined,
    limit: searching ? 300 : undefined,
    paidByIds,
    categoryIds,
    accountIds,
    kind: kind || undefined,
  });
  const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + t.amount_base, 0);
  const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + t.amount_base, 0);

  const groups = new Map<string, Transaction[]>();
  for (const t of txs) groups.set(t.date, [...(groups.get(t.date) ?? []), t]);
  const filtered = paidByIds.length > 0 || activeFilters > 0 || kind !== "" || searching;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Riwayat</h1>
          <p className="text-sm text-slate-500">Semua catatan keluarga, siapa pun yang mencatat.</p>
        </div>
        {!searching && <MonthNav month={month} setMonth={setMonth} />}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
          🔍
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
      </div>

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
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${activeFilters ? "bg-brand-600 text-white" : "bg-white text-slate-700 shadow-sm"}`}
          >
            ⚙️ Filter{activeFilters ? ` (${activeFilters})` : ""}
            <span className={`text-xs transition ${filtersOpen ? "rotate-180" : ""}`}>▾</span>
          </button>
          {activeFilters > 0 && (
            <button onClick={resetFilters} className="text-sm font-semibold text-slate-500 underline-offset-2 hover:underline">
              Reset
            </button>
          )}
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
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Akun</p>
              <MultiAccountPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />
            </div>
          </div>
        )}
      </div>

      {txs.length === 0 ? (
        <Card>
          <Empty icon="🔍" title={searching ? `Tidak ada yang cocok dengan “${search.trim()}”` : filtered ? "Tidak ada yang cocok" : "Belum ada transaksi bulan ini"}>
            {searching ? "Coba kata lain, nama orang, atau jumlah seperti 50rb." : null}
          </Empty>
        </Card>
      ) : (
        [...groups.entries()].map(([date, list]) => {
          const dayNet = list.reduce((s, t) => s + (t.kind === "income" ? t.amount_base : -t.amount_base), 0);
          return (
            <Card key={date} className="p-2 sm:p-3">
              <div className="flex justify-between px-2 pb-1 text-xs font-medium text-slate-500">
                <span className="capitalize">{formatDay(date)}</span>
                <span className="num">{formatIDR(dayNet)}</span>
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
