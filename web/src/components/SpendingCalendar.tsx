import { formatCompact, formatIDR, periodRange, todayISO } from "../lib/format";
import { cx } from "./ui";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
// Diverging: minus (more out than in) = brand coral, plus = mint, light -> dark.
// Index 0 = nothing / break-even.
const NEUTRAL = { bg: "var(--color-slate-50)", ink: "text-slate-400" };
const MINUS = [
  { bg: "var(--color-brand-100)", ink: "text-slate-800" },
  { bg: "var(--color-brand-200)", ink: "text-slate-800" },
  { bg: "var(--color-brand-500)", ink: "text-slate-900" },
  { bg: "var(--color-brand-700)", ink: "text-white" },
];
const PLUS = [
  { bg: "var(--color-mint-100)", ink: "text-slate-800" },
  { bg: "var(--color-mint-200)", ink: "text-slate-800" },
  { bg: "var(--color-mint-400)", ink: "text-slate-900" },
  { bg: "var(--color-mint-700)", ink: "text-white" },
];
const longDay = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" });
const shortDay = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short" });

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DayFlow {
  in: number;
  out: number;
}

const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±") + formatCompact(Math.abs(v)).replace(" ", "");

/**
 * "Kalender arus": net (masuk − keluar) per day of a budget month as a
 * diverging heatmap, so a day reads as plus or minus at a glance.
 * Tap a day to pick it (the list below shows only that day).
 */
export function SpendingCalendar({
  month,
  totals,
  selected,
  onSelect,
}: {
  month: string;
  /** Income and expense in rupiah per ISO date. */
  totals: Map<string, DayFlow>;
  selected: string | null;
  onSelect: (iso: string | null) => void;
}) {
  const { from, days } = periodRange(month);
  const today = todayISO();
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const lead = (new Date(from + "T00:00").getDay() + 6) % 7; // Monday first
  const net = (d: string) => {
    const f = totals.get(d);
    return f ? f.in - f.out : 0;
  };
  // Each side scales on its own, so one payday doesn't wash out every minus day.
  const maxPlus = Math.max(0, ...dates.map(net));
  const maxMinus = Math.max(0, ...dates.map((d) => -net(d)));
  const step = (v: number) => {
    const max = v > 0 ? maxPlus : maxMinus;
    if (v === 0 || max <= 0) return NEUTRAL;
    const i = Math.min(3, Math.max(0, Math.ceil((Math.abs(v) / max) * 4) - 1));
    return (v > 0 ? PLUS : MINUS)[i];
  };
  const worst = dates.reduce<string | null>((b, d) => (net(d) < (b ? net(b) : 0) ? d : b), null);
  const plusDays = dates.filter((d) => net(d) > 0).length;
  const minusDays = dates.filter((d) => net(d) < 0).length;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Kalender masuk dan keluar">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {dates.map((d) => {
          const f = totals.get(d);
          const has = !!f && (f.in > 0 || f.out > 0);
          const v = net(d);
          const st = step(v);
          const future = d > today;
          const isSel = selected === d;
          const label = `${longDay.format(new Date(d + "T00:00"))}: ${
            has ? `masuk ${formatIDR(f!.in)}, keluar ${formatIDR(f!.out)}, ${v >= 0 ? "plus" : "minus"} ${formatIDR(Math.abs(v))}` : "belum ada catatan"
          }${future && has ? " (bertanggal nanti)" : ""}`;
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
                future && has && "border-2 border-dashed border-slate-500",
                d === today && "ring-2 ring-slate-800 ring-offset-1",
                isSel && "ring-2 ring-brand-700 ring-offset-2",
              )}
              style={{ background: st.bg }}
            >
              <span className={cx("text-xs font-bold leading-none", st.ink)}>{Number(d.slice(8))}</span>
              {has && <span className={cx("num mt-0.5 text-[10px] font-semibold leading-none", st.ink)}>{signed(v)}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {plusDays + minusDays > 0 ? (
            <>
              {plusDays} hari plus · {minusDays} hari minus
              {worst && (
                <>
                  {" "}
                  · Paling minus: <b className="text-slate-700">{shortDay.format(new Date(worst + "T00:00"))}</b> {signed(net(worst))}
                </>
              )}
            </>
          ) : (
            "Belum ada catatan bulan ini"
          )}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          minus
          {[...MINUS].reverse().map((s, i) => (
            <span key={`m${i}`} className="h-2.5 w-3 rounded-sm" style={{ background: s.bg }} />
          ))}
          <span className="h-2.5 w-3 rounded-sm border border-slate-200" style={{ background: NEUTRAL.bg }} />
          {PLUS.map((s, i) => (
            <span key={`p${i}`} className="h-2.5 w-3 rounded-sm" style={{ background: s.bg }} />
          ))}
          plus
        </span>
      </div>
    </div>
  );
}
