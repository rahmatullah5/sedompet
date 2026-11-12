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

export function currentMonth() {
  return todayISO().slice(0, 7);
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
