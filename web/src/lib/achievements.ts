// Gamification inside one Dompet: streaks, XP/levels and badges, all
// computed from the family's own data on the device (nothing extra synced).
// Cooperative by design: family badges are earned together, and the family
// board shows everyone's streak to cheer each other on, not to rank.

import { all } from "../db/database";
import { q, type Member } from "../db/repo";
import type { LineIconName } from "../components/LineIcon";
import { currentMonth, shiftMonth, todayISO, toISODate } from "./format";

export interface MemberStats {
  entries: number;
  activeDays: number;
  receipts: number;
  needTags: number;
  merchants: number;
  splits: number;
  streak: number;
  bestStreak: number;
  /** Days this week (Mon-Sun) with an entry. */
  weekDays: number;
  recordedToday: boolean;
}

export interface FamilyStats {
  streak: number;
  bestStreak: number;
  budgets: number;
  goals: number;
  /** Last finished month: every budget stayed within its limit. */
  budgetsKeptLastMonth: boolean;
  surplusLastMonth: boolean;
  goalHalf: boolean;
  goalDone: boolean;
  loansSettled: number;
  /** Every member who can record did so this week. */
  allActiveThisWeek: boolean;
  /** Weekly quest: each recording member logs on 3 different days. */
  quest: { done: number; target: number };
}

export interface Badge {
  id: string;
  scope: "me" | "family";
  icon: LineIconName;
  title: string;
  hint: string;
  value: number;
  target: number;
  unlocked: boolean;
}

export const LEVELS: { xp: number; title: string }[] = [
  { xp: 0, title: "Pencatat Pemula" },
  { xp: 60, title: "Mulai Rajin" },
  { xp: 160, title: "Pencatat Tekun" },
  { xp: 320, title: "Penjaga Dompet" },
  { xp: 550, title: "Bijak Belanja" },
  { xp: 850, title: "Ahli Anggaran" },
  { xp: 1250, title: "Pengatur Keuangan" },
  { xp: 1800, title: "Teladan Keluarga" },
  { xp: 2500, title: "Master Dompet" },
  { xp: 3500, title: "Legenda Sedompet" },
];

function dayAdd(iso: string, n: number) {
  const d = new Date(iso + "T00:00");
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Current streak (ending today, or yesterday if today isn't logged yet) and best streak. */
function streaks(days: string[], today: string) {
  const set = new Set(days);
  let best = 0;
  let run = 0;
  let prev = "";
  for (const d of [...set].sort()) {
    run = prev && dayAdd(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let cur = 0;
  let d = set.has(today) ? today : dayAdd(today, -1);
  while (set.has(d)) {
    cur++;
    d = dayAdd(d, -1);
  }
  return { streak: cur, best };
}

function weekStart(today: string) {
  const d = new Date(today + "T00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISODate(d);
}

/** Entries that count as "recording": real income/expense and transfers, not balance corrections. */
const COUNTED = `t.dompet_id = $d AND (t.flag IS NULL OR t.flag = 'transfer') AND t.date <= $today`;

export function memberStats(dompetId: string, memberId: string): MemberStats {
  const today = todayISO();
  const p = { $d: dompetId, $m: memberId, $today: today };
  const agg = all<{ entries: number; receipts: number; need: number; merchants: number; splits: number }>(
    `SELECT count(*) AS entries,
            count(t.receipt) AS receipts,
            count(t.need) AS need,
            count(DISTINCT lower(t.merchant)) AS merchants,
            count(t.split_with) AS splits
     FROM transactions t WHERE ${COUNTED} AND t.created_by = $m`,
    p,
  )[0];
  const days = all<{ date: string }>(`SELECT DISTINCT t.date FROM transactions t WHERE ${COUNTED} AND t.created_by = $m`, p).map((r) => r.date);
  const { streak, best } = streaks(days, today);
  const ws = weekStart(today);
  return {
    entries: agg?.entries ?? 0,
    activeDays: days.length,
    receipts: agg?.receipts ?? 0,
    needTags: agg?.need ?? 0,
    merchants: agg?.merchants ?? 0,
    splits: agg?.splits ?? 0,
    streak,
    bestStreak: best,
    weekDays: days.filter((d) => d >= ws).length,
    recordedToday: days.includes(today),
  };
}

export function familyStats(dompetId: string, me: string, members: Member[]): FamilyStats {
  const today = todayISO();
  const days = all<{ date: string }>(`SELECT DISTINCT t.date FROM transactions t WHERE ${COUNTED}`, { $d: dompetId, $today: today }).map((r) => r.date);
  const { streak, best } = streaks(days, today);
  const last = shiftMonth(currentMonth(), -1);
  const lastBudgets = q.budgets(dompetId, last);
  const series = q.monthlySeries(dompetId, me, [last])[0];
  const goals = q.goals(dompetId, me);
  const settled = all<{ n: number }>("SELECT count(*) AS n FROM loans WHERE dompet_id = ? AND settled = 1", [dompetId])[0]?.n ?? 0;
  const recorders = members.filter((m) => m.role !== "viewer");
  const week = recorders.map((m) => memberStats(dompetId, m.id).weekDays);
  return {
    streak,
    bestStreak: best,
    budgets: q.budgets(dompetId, currentMonth()).length,
    goals: goals.length,
    budgetsKeptLastMonth: lastBudgets.length > 0 && lastBudgets.every((b) => b.spent <= b.limit) && (series?.expense ?? 0) > 0,
    surplusLastMonth: !!series && series.expense > 0 && series.income > series.expense,
    goalHalf: goals.some((g) => g.progress * 2 >= g.target),
    goalDone: goals.some((g) => g.progress >= g.target),
    loansSettled: settled,
    allActiveThisWeek: recorders.length > 1 && week.every((d) => d > 0),
    quest: { done: week.reduce((t, d) => t + Math.min(3, d), 0), target: recorders.length * 3 },
  };
}

const tier = (id: string, icon: LineIconName, title: string, hint: string, value: number, target: number, scope: Badge["scope"] = "me"): Badge => ({
  id,
  scope,
  icon,
  title,
  hint,
  value: Math.min(value, target),
  target,
  unlocked: value >= target,
});

export function badges(me: MemberStats, fam: FamilyStats): Badge[] {
  return [
    tier("first", "sparkle", "Langkah Pertama", "Catat transaksi pertamamu", me.entries, 1),
    tier("streak3", "flame", "Mulai Konsisten", "Mencatat 3 hari berturut-turut", me.bestStreak, 3),
    tier("streak7", "flame", "Seminggu Penuh", "Mencatat 7 hari berturut-turut", me.bestStreak, 7),
    tier("streak30", "flame", "Sebulan Tanpa Bolong", "Mencatat 30 hari berturut-turut", me.bestStreak, 30),
    tier("streak100", "flame", "Disiplin Baja", "Mencatat 100 hari berturut-turut", me.bestStreak, 100),
    tier("entries50", "book", "Rajin Mencatat", "50 catatan", me.entries, 50),
    tier("entries200", "book", "Pencatat Andal", "200 catatan", me.entries, 200),
    tier("entries500", "book", "Arsiparis Keluarga", "500 catatan", me.entries, 500),
    tier("receipt1", "receipt", "Struk Pertama", "Lampirkan foto struk", me.receipts, 1),
    tier("receipt20", "receipt", "Kolektor Struk", "20 catatan dengan foto struk", me.receipts, 20),
    tier("need20", "heart", "Bijak Memilih", "Tandai 20 catatan Kebutuhan/Keinginan", me.needTags, 20),
    tier("merchant15", "store", "Tahu Belanja di Mana", "Isi tempat beli di 15 toko berbeda", me.merchants, 15),
    tier("split1", "split", "Adil Patungan", "Bagi satu pengeluaran dengan anggota lain", me.splits, 1),
    tier("fplan", "piggy", "Punya Rencana", "Buat anggaran pertama keluarga", fam.budgets, 1, "family"),
    tier("fdream", "target", "Punya Impian", "Buat tujuan tabungan pertama", fam.goals, 1, "family"),
    tier("fstreak7", "users", "Keluarga Kompak", "Keluarga mencatat 7 hari berturut-turut", fam.bestStreak, 7, "family"),
    tier("fstreak30", "users", "Kompak Sebulan", "Keluarga mencatat 30 hari berturut-turut", fam.bestStreak, 30, "family"),
    tier("fteam", "people", "Satu Tim", "Semua anggota mencatat dalam minggu yang sama", fam.allActiveThisWeek ? 1 : 0, 1, "family"),
    tier("fbudget", "shield", "Anggaran Aman", "Semua anggaran tidak terlewati bulan lalu", fam.budgetsKeptLastMonth ? 1 : 0, 1, "family"),
    tier("fsurplus", "up", "Bulan Surplus", "Pemasukan lebih besar dari pengeluaran bulan lalu", fam.surplusLastMonth ? 1 : 0, 1, "family"),
    tier("fhalf", "target", "Setengah Jalan", "Satu tujuan tabungan sudah 50%", fam.goalHalf ? 1 : 0, 1, "family"),
    tier("fgoal", "star", "Impian Tercapai", "Satu tujuan tabungan tercapai", fam.goalDone ? 1 : 0, 1, "family"),
    tier("floan", "handshake", "Bebas Utang", "Lunasi satu pinjaman", fam.loansSettled, 1, "family"),
  ];
}

export function xpOf(me: MemberStats, list: Badge[]) {
  const mine = list.filter((b) => b.unlocked && b.scope === "me").length;
  const fam = list.filter((b) => b.unlocked && b.scope === "family").length;
  return me.entries * 2 + me.activeDays * 10 + me.receipts * 5 + me.needTags * 2 + mine * 25 + fam * 15;
}

export function levelOf(xp: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i];
  const next = LEVELS[i + 1];
  return { level: i + 1, title: cur.title, xp, from: cur.xp, to: next?.xp ?? null };
}

/** Everything the screens need for one member. */
export function progressFor(dompetId: string, member: Member, members: Member[]) {
  const me = memberStats(dompetId, member.id);
  const fam = familyStats(dompetId, member.id, members);
  const list = badges(me, fam);
  return { me, fam, badges: list, level: levelOf(xpOf(me, list)) };
}

/** Lighter version for the family board (no family badges needed twice). */
export function boardFor(dompetId: string, members: Member[], fam: FamilyStats) {
  return members.map((m) => {
    const s = memberStats(dompetId, m.id);
    return { member: m, stats: s, level: levelOf(xpOf(s, badges(s, fam))) };
  });
}
