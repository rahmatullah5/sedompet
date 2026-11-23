import { useState } from "react";
import { mq, occurrences, type Recurring as Rec } from "../db/money";
import { formatCompact, formatDay, formatIDR, toISODate, todayISO } from "../lib/format";
import { formatMoney } from "../lib/currency";
import { Icon } from "./Icon";
import { cx } from "./ui";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const monthTitle = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
const FILTER_KEY = "sedompet.rutin.calFilter";

type Status = "paid" | "late" | "today" | "soon";
type Filter = "all" | "expense" | "income";
interface Entry {
  rec: Rec;
  date: string;
  amount: number; // base currency, for totals
  status: Status;
}

const STATUS: Record<Status, { label: string; cell: string; chip: string }> = {
  paid: { label: "Lunas", cell: "bg-slate-200/70", chip: "bg-mint-200 text-mint-700" },
  late: { label: "Telat", cell: "bg-red-100", chip: "bg-red-200 text-red-800" },
  today: { label: "Hari ini", cell: "bg-sun-100", chip: "bg-sun-100 text-amber-700" },
  soon: { label: "Akan datang", cell: "bg-brand-100", chip: "bg-slate-100 text-slate-600" },
};
// Income reads differently: "Diterima" instead of "Lunas", "Belum masuk" instead of "Telat".
const statusLabel = (e: Entry) =>
  e.rec.kind === "income" ? ({ paid: "Diterima", late: "Belum masuk", today: "Hari ini", soon: "Akan datang" } as const)[e.status] : STATUS[e.status].label;

const FILTERS: [Filter, string][] = [
  ["all", "Semua"],
  ["expense", "Tagihan"],
  ["income", "Pemasukan"],
];

function loadFilter(): Filter {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    return v === "expense" || v === "income" ? v : "all";
  } catch {
    return "all";
  }
}

/**
 * Tagihan & langganan plus pemasukan rutin as one month calendar: what is due
 * on which day, what was already paid/received (via "Bayar"/"Terima") and what
 * is late. A toggle narrows it to bills or income. Tap a day to see its items.
 */
export function BillCalendar({
  dompetId,
  me,
  items,
  onOpen,
}: {
  dompetId: string;
  me: string;
  items: Rec[];
  onOpen?: (r: Rec) => void;
}) {
  const today = todayISO();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilterState] = useState<Filter>(loadFilter);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* private mode */
    }
  };
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  const from = toISODate(first);
  const to = toISODate(last);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const dates = Array.from({ length: last.getDate() }, (_, i) => toISODate(new Date(first.getFullYear(), first.getMonth(), i + 1)));

  const shown = items.filter((r) => filter === "all" || r.kind === filter);
  const byId = new Map(shown.map((r) => [r.id, r]));
  const entries: Entry[] = [];
  for (const p of mq.recurringPaid(dompetId, me, from, to)) {
    const rec = byId.get(p.recurring_id);
    if (rec) entries.push({ rec, date: p.date, amount: p.amount_base, status: "paid" });
  }
  for (const r of shown) {
    for (const date of occurrences(r, from, to)) {
      entries.push({ rec: r, date, amount: r.amount_base, status: date < today ? "late" : date === today ? "today" : "soon" });
    }
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const perDay = new Map<string, Entry[]>();
  for (const e of entries) perDay.set(e.date, [...(perDay.get(e.date) ?? []), e]);

  const sum = (kind: "expense" | "income", paidOnly = false) =>
    entries.filter((e) => e.rec.kind === kind && (!paidOnly || e.status === "paid")).reduce((s, e) => s + e.amount, 0);
  const lateCount = entries.filter((e) => e.status === "late").length;
  const sel = selected && selected >= from && selected <= to ? selected : null;
  const agenda = sel ? (perDay.get(sel) ?? []) : entries;

  const cellStatus = (list: Entry[] | undefined): Status | null => {
    if (!list?.length) return null;
    for (const s of ["late", "today", "soon"] as const) if (list.some((e) => e.status === s)) return s;
    return "paid";
  };

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Tampilkan">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => setFilter(f)}
            className={cx("rounded-full py-1.5 text-xs font-semibold transition", filter === f ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Bulan sebelumnya" onClick={() => (setOffset(offset - 1), setSelected(null))} className="h-9 w-9 rounded-full bg-slate-100 font-bold text-slate-600 hover:bg-slate-200">
          ‹
        </button>
        <div className="text-center">
          <p className="font-bold capitalize text-slate-800">{monthTitle.format(first)}</p>
          <p className="text-xs text-slate-500">
            {filter !== "income" && (
              <>
                Tagihan <span className="num">{formatCompact(sum("expense"))}</span> (lunas <span className="num">{formatCompact(sum("expense", true))}</span>)
              </>
            )}
            {filter === "all" && " · "}
            {filter !== "expense" && (
              <>
                Masuk <span className="num text-mint-700">{formatCompact(sum("income"))}</span>
              </>
            )}
            {lateCount > 0 && <span className="font-semibold text-red-700"> · {lateCount} telat</span>}
          </p>
        </div>
        <button type="button" aria-label="Bulan berikutnya" onClick={() => (setOffset(offset + 1), setSelected(null))} className="h-9 w-9 rounded-full bg-slate-100 font-bold text-slate-600 hover:bg-slate-200">
          ›
        </button>
      </div>
      {offset !== 0 && (
        <button type="button" onClick={() => (setOffset(0), setSelected(null))} className="mt-1 w-full text-center text-xs font-semibold text-brand-700">
          Kembali ke bulan ini
        </button>
      )}

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Kalender rutin">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {dates.map((d) => {
          const list = perDay.get(d);
          const st = cellStatus(list);
          const isSel = sel === d;
          const hasIncome = list?.some((e) => e.rec.kind === "income");
          // Net of the day: more coming in than going out reads green, whatever the status.
          const net = (list ?? []).reduce((s, e) => s + (e.rec.kind === "income" ? e.amount : -e.amount), 0);
          const cell = !st ? "bg-slate-50" : net > 0 ? "bg-mint-100" : STATUS[st].cell;
          const label = `${formatDay(d)}: ${
            list?.length ? list.map((e) => `${e.rec.name} ${e.rec.kind === "income" ? "+" : "−"}${formatIDR(e.amount)} (${statusLabel(e)})`).join(", ") : "tidak ada yang rutin"
          }`;
          return (
            <button
              key={d}
              type="button"
              aria-label={label}
              aria-pressed={isSel}
              title={label}
              onClick={() => setSelected(isSel ? null : d)}
              className={cx(
                "relative flex aspect-square min-h-11 flex-col items-center justify-start gap-0.5 rounded-xl pt-1 transition active:scale-95",
                cell,
                d === today && "ring-2 ring-slate-800 ring-offset-1",
                isSel && "ring-2 ring-brand-700 ring-offset-2",
              )}
            >
              {hasIncome && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-mint-600" aria-hidden />}
              <span className={cx("text-xs font-bold leading-none", st ? "text-slate-800" : "text-slate-400")}>{Number(d.slice(8))}</span>
              {list && (
                <span className="flex items-center justify-center">
                  {list.slice(0, 2).map((e, i) => (
                    <span key={i} className={cx("relative -mx-0.5", e.status === "paid" && "opacity-60")}>
                      <Icon value={e.rec.icon ?? e.rec.category_icon ?? (e.rec.kind === "income" ? "💼" : "🧾")} size={16} />
                    </span>
                  ))}
                  {list.length > 2 && <span className="text-[9px] font-bold text-slate-500">+{list.length - 2}</span>}
                </span>
              )}
              {st === "paid" && <span className="text-[9px] font-bold leading-none text-mint-700">✓</span>}
              {st === "late" && <span className="text-[9px] font-bold leading-none text-red-700">!</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500" aria-hidden>
        {(["soon", "today", "late", "paid"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={cx("h-2.5 w-2.5 rounded-sm border border-slate-200", STATUS[s].cell)} />
            {STATUS[s].label}
          </span>
        ))}
        {filter !== "expense" && (
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-mint-100" />
            Lebih banyak masuk
          </span>
        )}
        {filter === "all" && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-mint-600" />
            ada pemasukan
          </span>
        )}
      </div>

      <div className="mt-3 border-t border-slate-100 pt-2">
        <div className="flex items-center justify-between px-1 text-xs font-semibold text-slate-500">
          <span className={sel ? "capitalize" : undefined}>{sel ? formatDay(sel) : "Semua bulan ini"}</span>
          {sel && (
            <button type="button" onClick={() => setSelected(null)} className="hover:underline">
              ✕ Semua tanggal
            </button>
          )}
        </div>
        {agenda.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-400">Tidak ada yang rutin.</p>
        ) : (
          <ul className="-mx-2 mt-1">
            {agenda.map((e, i) => {
              const income = e.rec.kind === "income";
              return (
                <li key={`${e.rec.id}-${e.date}-${i}`}>
                  <button
                    type="button"
                    disabled={!onOpen}
                    onClick={() => onOpen?.(e.rec)}
                    className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left enabled:hover:bg-slate-50"
                  >
                    <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl", income ? "bg-mint-100" : "bg-slate-100")}>
                      <Icon value={e.rec.icon ?? e.rec.category_icon ?? (income ? "💼" : "🧾")} size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{e.rec.name}</span>
                      <span className="text-xs text-slate-500">{formatDay(e.date)}</span>
                    </span>
                    <span className="flex flex-col items-end gap-0.5">
                      <span className={cx("num text-sm font-bold", income ? "text-mint-600" : "text-slate-800")}>
                        {income ? "+" : ""}
                        {e.status === "paid" ? formatIDR(e.amount) : formatMoney(e.rec.amount, e.rec.account_currency)}
                      </span>
                      <span className={cx("rounded-full px-2 py-px text-[10px] font-bold", STATUS[e.status].chip)}>{statusLabel(e)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
