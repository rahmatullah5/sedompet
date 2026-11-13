import { useMemo, useState } from "react";
import { toISODate, todayISO } from "../lib/format";
import { cx } from "./ui";

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const longFmt = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const monthFmt = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });

const parse = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
};
const addMonths = (iso: string, n: number) => {
  const d = parse(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
};

/** "Hari ini", "Kemarin", "Besok" or the weekday, plus the full date. */
function friendly(iso: string) {
  const today = todayISO();
  const rel = iso === today ? "Hari ini" : iso === addDays(today, -1) ? "Kemarin" : iso === addDays(today, 1) ? "Besok" : null;
  const full = longFmt.format(parse(iso));
  return { rel, full };
}

type Preset = "past" | "future" | "goal";

export function DatePicker({
  value,
  onChange,
  min,
  max,
  optional,
  placeholder = "Pilih tanggal",
  presets = "past",
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  /** Allows clearing the date (e.g. "Jatuh tempo" is optional). */
  optional?: boolean;
  placeholder?: string;
  presets?: Preset;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => (value || todayISO()).slice(0, 7) + "-01");
  const today = todayISO();
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  const quick = useMemo(() => {
    const list =
      presets === "past"
        ? [
            { label: "Hari ini", iso: today },
            { label: "Kemarin", iso: addDays(today, -1) },
            { label: "2 hari lalu", iso: addDays(today, -2) },
          ]
        : presets === "goal"
          ? [
              { label: "+6 bulan", iso: addMonths(today, 6) },
              { label: "+1 tahun", iso: addMonths(today, 12) },
              { label: "+2 tahun", iso: addMonths(today, 24) },
              { label: "+5 tahun", iso: addMonths(today, 60) },
            ]
          : [
              { label: "Hari ini", iso: today },
              { label: "+1 minggu", iso: addDays(today, 7) },
              { label: "+1 bulan", iso: addMonths(today, 1) },
            ];
    return list.filter((q) => allowed(q.iso));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, today, min, max]);

  // Monday-first month grid.
  const cells = useMemo(() => {
    const first = parse(view);
    const offset = (first.getDay() + 6) % 7;
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= daysIn; d++) out.push(toISODate(new Date(first.getFullYear(), first.getMonth(), d)));
    while (out.length % 7) out.push(null);
    return out;
  }, [view]);

  const pick = (iso: string) => {
    onChange(iso);
    setView(iso.slice(0, 7) + "-01");
    setOpen(false);
  };
  const f = value ? friendly(value) : null;
  const shiftView = (n: number) => setView(addMonths(view, n));
  const canPrev = !min || addMonths(view, -1).slice(0, 7) >= min.slice(0, 7);
  const canNext = !max || addMonths(view, 1).slice(0, 7) <= max.slice(0, 7);

  return (
    <div>
      {label && <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>}
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setView((value || today).slice(0, 7) + "-01");
        }}
        aria-expanded={open}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-2xl border-2 px-3 py-2 text-left transition",
          open ? "border-brand-500 bg-white" : "border-transparent bg-slate-100 hover:bg-slate-200/70",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-lg bg-white text-center shadow-sm">
          <span className="text-[9px] font-bold uppercase leading-none text-brand-600">
            {value ? new Intl.DateTimeFormat("id-ID", { month: "short" }).format(parse(value)) : "📅"}
          </span>
          {value && <span className="text-sm font-extrabold leading-tight text-slate-800">{parse(value).getDate()}</span>}
        </span>
        <span className="min-w-0 flex-1">
          {f ? (
            <span className="block truncate text-[15px] text-slate-800">
              <b className="font-semibold">{f.rel ?? f.full.split(",")[0]}</b>
              <span className="text-slate-500"> · {f.rel ? f.full : f.full.split(", ").slice(1).join(", ")}</span>
            </span>
          ) : (
            <span className="text-[15px] text-slate-400">{placeholder}</span>
          )}
        </span>
        <span className={cx("text-slate-400 transition", open && "rotate-180")}>▾</span>
      </button>

      {open && (
        <div className="pop-in mt-2 rounded-2xl bg-white p-3 shadow-[0_10px_30px_-12px_rgba(120,72,40,0.35)] ring-1 ring-slate-100">
          {quick.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => pick(q.iso)}
                  className={cx(
                    "rounded-full px-3 py-1 text-xs font-semibold transition",
                    value === q.iso ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-brand-100 hover:text-brand-800",
                  )}
                >
                  {q.label}
                </button>
              ))}
              {optional && value && (
                <button type="button" onClick={() => (onChange(""), setOpen(false))} className="rounded-full px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50">
                  Hapus tanggal
                </button>
              )}
            </div>
          )}

          <div className="mb-2 flex items-center justify-between">
            <button type="button" disabled={!canPrev} onClick={() => shiftView(-1)} aria-label="Bulan sebelumnya" className="h-9 w-9 rounded-full text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30">
              ‹
            </button>
            <span className="text-sm font-bold capitalize text-slate-800">{monthFmt.format(parse(view))}</span>
            <button type="button" disabled={!canNext} onClick={() => shiftView(1)} aria-label="Bulan berikutnya" className="h-9 w-9 rounded-full text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30">
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center" role="grid">
            {DAYS.map((d, i) => (
              <span key={d} className={cx("pb-1 text-[11px] font-semibold", i >= 5 ? "text-brand-600" : "text-slate-400")}>
                {d}
              </span>
            ))}
            {cells.map((iso, i) =>
              iso === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={iso}
                  type="button"
                  disabled={!allowed(iso)}
                  onClick={() => pick(iso)}
                  aria-label={longFmt.format(parse(iso))}
                  aria-pressed={iso === value}
                  className={cx(
                    "relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm transition disabled:cursor-not-allowed disabled:opacity-25",
                    iso === value
                      ? "bg-brand-600 font-bold text-white shadow-sm shadow-brand-600/40"
                      : "font-medium text-slate-700 enabled:hover:bg-brand-50",
                  )}
                >
                  {parse(iso).getDate()}
                  {iso === today && iso !== value && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brand-500" />}
                </button>
              ),
            )}
          </div>

          {value !== today && allowed(today) && (
            <button type="button" onClick={() => pick(today)} className="mt-2 w-full rounded-xl py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
              Kembali ke hari ini
            </button>
          )}
        </div>
      )}
    </div>
  );
}
