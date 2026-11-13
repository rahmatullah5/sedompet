import { formatCompact, formatIDR, periodRange, todayISO } from "../lib/format";
import { cx } from "./ui";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
// Sequential: one hue (brand), light -> dark. Index 0 = no spending.
const STEPS = [
  { bg: "var(--color-slate-50)", ink: "text-slate-400" },
  { bg: "var(--color-brand-100)", ink: "text-slate-800" },
  { bg: "var(--color-brand-200)", ink: "text-slate-800" },
  { bg: "var(--color-brand-500)", ink: "text-slate-900" },
  { bg: "var(--color-brand-700)", ink: "text-white" },
];
const longDay = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short" });

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Kalender belanja": spending per day of a budget month as a heatmap.
 * Tap a day to pick it (the list below shows only that day).
 */
export function SpendingCalendar({
  month,
  totals,
  selected,
  onSelect,
}: {
  month: string;
  /** Expense in rupiah per ISO date. */
  totals: Map<string, number>;
  selected: string | null;
  onSelect: (iso: string | null) => void;
}) {
  const { from, days } = periodRange(month);
  const today = todayISO();
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const lead = (new Date(from + "T00:00").getDay() + 6) % 7; // Monday first
  const max = Math.max(0, ...dates.map((d) => totals.get(d) ?? 0));
  const level = (v: number) => (v <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((v / max) * 4))));
  const top = dates.reduce<string | null>((best, d) => ((totals.get(d) ?? 0) > (best ? (totals.get(best) ?? 0) : 0) ? d : best), null);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Kalender belanja">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {dates.map((d) => {
          const v = totals.get(d) ?? 0;
          const step = STEPS[level(v)];
          const future = d > today;
          const isSel = selected === d;
          const label = `${longDay.format(new Date(d + "T00:00"))}: ${v > 0 ? `keluar ${formatIDR(v)}` : "belum ada pengeluaran"}${future && v > 0 ? " (bertanggal nanti)" : ""}`;
          return (
            <button
              key={d}
              type="button"
              aria-label={label}
              aria-pressed={isSel}
              title={label}
              onClick={() => onSelect(isSel ? null : d)}
              className={cx(
                "flex aspect-square min-h-11 flex-col items-center justify-center rounded-xl text-center transition active:scale-95",
                future && v > 0 && "border-2 border-dashed border-brand-600",
                d === today && "ring-2 ring-slate-800 ring-offset-1",
                isSel && "ring-2 ring-brand-700 ring-offset-2",
              )}
              style={{ background: step.bg }}
            >
              <span className={cx("text-xs font-bold leading-none", step.ink)}>{Number(d.slice(8))}</span>
              {v > 0 && <span className={cx("num mt-0.5 text-[10px] font-semibold leading-none", step.ink)}>{formatCompact(v).replace(" ", "")}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {top ? (
            <>
              Paling boros: <b className="text-slate-700">{shortDay.format(new Date(top + "T00:00"))}</b> · {formatCompact(totals.get(top) ?? 0)}
            </>
          ) : (
            "Belum ada pengeluaran bulan ini"
          )}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          sedikit
          {STEPS.slice(1).map((s, i) => (
            <span key={i} className="h-2.5 w-4 rounded-sm" style={{ background: s.bg }} />
          ))}
          banyak
        </span>
      </div>
    </div>
  );
}
