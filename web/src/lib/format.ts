const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIDR(amount: number) {
  return rupiah.format(amount);
}

/** "1,2 jt", "350 rb": compact labels for charts. */
export function formatCompact(amount: number) {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)} jt`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)} rb`;
  return `${sign}${abs}`;
}

function trim(n: number) {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

/** Parses "25.000", "25000", "25rb", "1,5jt" into rupiah. */
export function parseAmount(input: string): number {
  const s = input.trim().toLowerCase().replace(/\s/g, "");
  const m = s.match(/^([\d.,]+)(rb|k|jt|m)?$/);
  if (!m) return NaN;
  const [, num, unit] = m;
  let value: number;
  if (unit) {
    // With a unit, "," or "." is a decimal separator: 1,5jt / 1.5jt
    value = Number(num.replace(",", "."));
  } else {
    // Without a unit, "." and "," are thousands separators: 25.000
    value = Number(num.replace(/[.,]/g, ""));
  }
  const mult = unit === "rb" || unit === "k" ? 1_000 : unit === "jt" || unit === "m" ? 1_000_000 : 1;
  return Math.round(value * mult);
}

export function todayISO() {
  return toISODate(new Date());
}

export function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Budget "months" (periods). A Dompet can start its month on payday (1-28).
// A period is still named by a "YYYY-MM" key:
//   start 1-15  -> named after the month it starts in (5 Nov - 4 Des = "Nov")
//   start 16-28 -> named after the month it ends in (25 Okt - 24 Nov = "Nov")
// so the name is always the month holding most of its days.
// ---------------------------------------------------------------------------
let periodStartDay = 1;

/** Set from the current Dompet's setting (App does this on every render). */
export function setPeriodStartDay(day: number | null | undefined) {
  periodStartDay = Math.min(28, Math.max(1, Math.round(day ?? 1) || 1));
}
export function getPeriodStartDay() {
  return periodStartDay;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** First and last date (inclusive) of a period, and its length in days. */
export function periodRange(month: string, start = periodStartDay): { from: string; to: string; days: number } {
  const startMonth = start > 15 ? shiftMonth(month, -1) : month;
  const from = `${startMonth}-${pad2(start)}`;
  const [y, m] = shiftMonth(startMonth, 1).split("-").map(Number);
  const to = toISODate(new Date(y, m - 1, start - 1)); // day 0 = last day of the previous month
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from, to, days };
}

/** The period key ("YYYY-MM") a date belongs to. */
export function periodOf(iso: string, start = periodStartDay): string {
  const day = Number(iso.slice(8, 10));
  const startMonth = day >= start ? iso.slice(0, 7) : shiftMonth(iso.slice(0, 7), -1);
  return start > 15 ? shiftMonth(startMonth, 1) : startMonth;
}

/** Day number inside its period, 1-based. */
export function periodDay(iso: string, month: string) {
  return Math.round((Date.parse(iso) - Date.parse(periodRange(month).from)) / 86_400_000) + 1;
}

/** SQLite expression giving the month a date's period STARTS in (see periodKeyFromStart). */
export function periodStartSql(col: string, start = periodStartDay) {
  return start === 1 ? `substr(${col}, 1, 7)` : `substr(date(${col}, '-${start - 1} days'), 1, 7)`;
}
export function periodKeyFromStart(startMonth: string, start = periodStartDay) {
  return start > 15 ? shiftMonth(startMonth, 1) : startMonth;
}

const shortDayMonth = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
/** "25 Okt – 24 Nov" (empty when the month simply starts on the 1st). */
export function formatPeriodRange(month: string) {
  if (periodStartDay === 1) return "";
  const { from, to } = periodRange(month);
  return `${shortDayMonth.format(new Date(from + "T00:00"))} – ${shortDayMonth.format(new Date(to + "T00:00"))}`;
}

/** Current period key (the calendar month when the month starts on the 1st). */
export function currentMonth() {
  return periodOf(todayISO());
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return toISODate(d).slice(0, 7);
}

const monthFmt = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
export function formatMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
}

const dayFmt = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long" });
export function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = todayISO();
  const yesterday = toISODate(new Date(Date.now() - 86_400_000));
  if (iso === today) return "Hari ini";
  if (iso === yesterday) return "Kemarin";
  return dayFmt.format(date);
}

/** SQLite datetime('now') is UTC "YYYY-MM-DD HH:MM:SS". */
export function timeAgo(sqliteUtc: string) {
  const then = new Date(sqliteUtc.replace(" ", "T") + "Z").getTime();
  const sec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (sec < 60) return "baru saja";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.round(hr / 24);
  return `${day} hari lalu`;
}
