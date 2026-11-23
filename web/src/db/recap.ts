// Weekly recap ("Rekap minggu ini"): shared-account spending only, because the
// recap is meant to be shared with the whole family (e.g. in a WhatsApp group).

import { all, get } from "./database";
import { baseSql } from "../lib/currency";
import { formatCompact, formatIDR, toISODate, todayISO } from "../lib/format";

const AMT = baseSql("t.amount");
const SHARED = `t.dompet_id = $d AND a.visibility = 'shared' AND t.flag IS NULL`;

export interface WeekRange {
  from: string;
  to: string;
  label: string;
}

const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

/** Monday-Sunday week containing `iso`, shifted by `offset` weeks. */
export function weekRange(offset = 0, iso = todayISO()): WeekRange {
  const d = new Date(iso + "T00:00");
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: toISODate(monday), to: toISODate(sunday), label: `${dayFmt.format(monday)} – ${dayFmt.format(sunday)}` };
}

function spent(dompetId: string, from: string, to: string) {
  return (
    get<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(${AMT}), 0) AS total, COUNT(*) AS count
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE ${SHARED} AND t.kind = 'expense' AND t.date BETWEEN $from AND $to`,
      { $d: dompetId, $from: from, $to: to },
    ) ?? { total: 0, count: 0 }
  );
}

export function weeklyRecap(dompetId: string, offset = 0) {
  const week = weekRange(offset);
  const prev = weekRange(offset - 1);
  // A week in progress is compared with the same days of the week before.
  const today = todayISO();
  const upTo = week.to > today ? today : week.to;
  const daysSoFar = Math.round((Date.parse(upTo) - Date.parse(week.from)) / 86_400_000) + 1;
  const prevUpTo = toISODate(new Date(new Date(prev.from + "T00:00").getTime() + (daysSoFar - 1) * 86_400_000));
  const p = { $d: dompetId, $from: week.from, $to: upTo };

  const now = spent(dompetId, week.from, upTo);
  const before = spent(dompetId, prev.from, prevUpTo);
  const income = get<{ total: number }>(
    `SELECT COALESCE(SUM(${AMT}), 0) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE ${SHARED} AND t.kind = 'income' AND t.date BETWEEN $from AND $to`,
    p,
  )?.total ?? 0;
  const categories = all<{ name: string; icon: string; total: number }>(
    `SELECT COALESCE(top.name, 'Tanpa kategori') AS name, COALESCE(top.icon, '📦') AS icon, SUM(${AMT}) AS total
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN categories top ON top.id = COALESCE(c.parent_id, c.id)
     WHERE ${SHARED} AND t.kind = 'expense' AND t.date BETWEEN $from AND $to
     GROUP BY top.id ORDER BY total DESC LIMIT 3`,
    p,
  );
  const people = all<{ name: string; emoji: string; total: number }>(
    `SELECT m.name, m.emoji, SUM(${AMT}) AS total
     FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN members m ON m.id = t.paid_by
     WHERE ${SHARED} AND t.kind = 'expense' AND t.date BETWEEN $from AND $to
     GROUP BY m.id ORDER BY total DESC`,
    p,
  );
  const biggest = get<{ note: string; total: number; category: string | null }>(
    `SELECT t.note, ${AMT} AS total, c.name AS category
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${SHARED} AND t.kind = 'expense' AND t.date BETWEEN $from AND $to
     ORDER BY total DESC LIMIT 1`,
    p,
  );
  const change = before.total > 0 ? Math.round(((now.total - before.total) / before.total) * 100) : null;
  return { offset, week, upTo, daysSoFar, inProgress: upTo < week.to, spent: now.total, entries: now.count, before: before.total, change, income, categories, people, biggest };
}

export type WeeklyRecap = ReturnType<typeof weeklyRecap>;

/** WhatsApp-ready text (WA renders *bold*). */
export function recapText(r: WeeklyRecap, dompetName: string, extra?: { budgetLine?: string }) {
  const lines = [
    `*Rekap ${r.offset === 0 ? "minggu ini" : r.offset === -1 ? "minggu lalu" : "mingguan"} · ${dompetName}*`,
    `${r.week.label}${r.inProgress ? ` (sampai hari ini)` : ""}`,
    "",
    `Keluar *${formatIDR(r.spent)}* dari ${r.entries} catatan`,
  ];
  if (r.change !== null) lines.push(r.change === 0 ? "Sama dengan minggu sebelumnya" : `${r.change > 0 ? "Naik" : "Turun"} ${Math.abs(r.change)}% ${r.change > 0 ? "lebih banyak" : "lebih hemat"} dari minggu sebelumnya`);
  if (r.income > 0) lines.push(`Masuk ${formatIDR(r.income)}`);
  if (r.categories.length) {
    lines.push("", "*Paling banyak untuk:*");
    r.categories.forEach((c, i) => lines.push(`${i + 1}. ${c.name} · ${formatCompact(c.total)}`));
  }
  if (r.people.length > 1) {
    lines.push("", "*Siapa belanja:*");
    r.people.forEach((p) => lines.push(`- ${p.name} · ${formatCompact(p.total)}`));
  }
  if (r.biggest && r.biggest.total > 0) lines.push("", `Terbesar: ${r.biggest.note || r.biggest.category || "Tanpa catatan"} · ${formatCompact(r.biggest.total)}`);
  if (extra?.budgetLine) lines.push("", extra.budgetLine);
  lines.push("", "_dari Sedompet · sedompet.vercel.app_");
  return lines.join("\n");
}
