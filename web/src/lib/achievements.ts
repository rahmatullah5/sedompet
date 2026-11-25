// Gamification inside one Dompet: streaks, XP/levels and badges, all
// computed from the family's own data on the device (nothing extra synced).
// Cooperative by design: family badges are earned together, and the family
// board shows everyone's streak to cheer each other on, not to rank.

import { all } from "../db/database";
import { q, type Member } from "../db/repo";
import type { LineIconName } from "../components/LineIcon";
import { currentMonth, periodRange as periodRangeOf, shiftMonth, todayISO, toISODate } from "./format";

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
  /** Days since your last entry (0 = today; Infinity = never). */
  daysSinceLast: number;
  /** Most "Keinginan" entries you made on one day in the last 7 days. */
  maxWantsPerDay: number;
  /** Entries you typed between 00:00 and 03:59 in the last 30 days. */
  lateNight: number;
  /** Food & drink entries you recorded in the last 7 days. */
  snacksWeek: number;
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
  /** Budgets past their limit right now. */
  overBudgets: string[];
  /** Spent more than earned last month. */
  deficitLastMonth: boolean;
  /** 90% of the total budget gone with 10+ days of the month left. */
  earlyBurn: boolean;
  /** Rutin bills whose date has passed without being recorded. */
  overdueBills: number;
  /** Loans past their due date. */
  overdueLoans: number;
}

/** A playful "kartu kuning": on while the habit lasts, gone once fixed. */
export interface Penalty {
  id: string;
  scope: "me" | "family";
  icon: LineIconName;
  title: string;
  /** Why you got it (a joke, but true). */
  joke: string;
  /** How to get rid of it. */
  fix: string;
  xp: number;
  active: boolean;
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
  const lastDay = days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
  const daysSinceLast = lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / 86_400_000) : Infinity;
  const weekAgo = dayAdd(today, -6);
  const maxWantsPerDay =
    all<{ n: number }>(
      `SELECT count(*) AS n FROM transactions t WHERE ${COUNTED} AND t.created_by = $m AND t.need = 'want' AND t.date >= $from GROUP BY t.date ORDER BY n DESC LIMIT 1`,
      { ...p, $from: weekAgo },
    )[0]?.n ?? 0;
  // created_at is UTC; the hour is checked in the device's time zone.
  const recent = all<{ created_at: string }>(
    `SELECT t.created_at FROM transactions t WHERE ${COUNTED} AND t.created_by = $m AND t.created_at >= $since`,
    { ...p, $since: dayAdd(today, -31) },
  );
  const lateNight = recent.filter((r) => {
    const h = new Date(r.created_at.replace(" ", "T") + "Z").getHours();
    return h >= 0 && h < 4;
  }).length;
  const snacksWeek =
    all<{ n: number }>(
      `SELECT count(*) AS n FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
       WHERE ${COUNTED} AND t.created_by = $m AND t.kind = 'expense' AND t.date >= $from
         AND (lower(COALESCE(pc.name, c.name, '')) LIKE '%makan%' OR lower(COALESCE(pc.name, c.name, '')) LIKE '%jajan%' OR lower(COALESCE(pc.name, c.name, '')) LIKE '%food%')`,
      { ...p, $from: weekAgo },
    )[0]?.n ?? 0;
  return {
    daysSinceLast,
    maxWantsPerDay,
    lateNight,
    snacksWeek,
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
  const now = q.budgets(dompetId, currentMonth());
  const overall = q.overallBudget(dompetId, me, currentMonth());
  const range = periodRangeOf(currentMonth());
  const daysLeft = Math.round((Date.parse(range.to) - Date.parse(today)) / 86_400_000) + 1;
  const overdueBills =
    all<{ n: number }>(
      "SELECT count(*) AS n FROM recurring WHERE dompet_id = ? AND active = 1 AND next_date < ? AND (end_date IS NULL OR next_date <= end_date)",
      [dompetId, today],
    )[0]?.n ?? 0;
  const overdueLoans = all<{ n: number }>("SELECT count(*) AS n FROM loans WHERE dompet_id = ? AND settled = 0 AND due_date IS NOT NULL AND due_date < ?", [dompetId, today])[0]?.n ?? 0;
  return {
    overBudgets: now.filter((b) => b.spent > b.limit).map((b) => b.name),
    deficitLastMonth: !!series && series.income > 0 && series.expense > series.income,
    earlyBurn: !!overall && overall.amount > 0 && overall.spent >= overall.amount * 0.9 && daysLeft >= 10,
    overdueBills,
    overdueLoans,
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

const pen = (id: string, scope: Penalty["scope"], icon: LineIconName, title: string, joke: string, fix: string, xp: number, active: boolean): Penalty => ({
  id, scope, icon, title, joke, fix, xp, active,
});

/** Kartu kuning: just for fun, but each one is a real money habit to fix. */
/** Extra joke lines per kartu kuning (the first line stays in penalties()). */
const PENALTY_JOKES: Record<string, ((me: MemberStats, fam: FamilyStats, quiet: number) => string)[]> = {
  ghost: [
    (_m, _f, q) => `Sudah ${q} hari tidak mencatat. Uangnya ke mana, hayo?`,
    (_m, _f, q) => `${q} hari menghilang. Dompet sampai lapor ke RT.`,
    (_m, _f, q) => `${q} hari tanpa catatan. Uangnya jalan-jalan sendiri?`,
    (_m, _f, q) => `Hilang ${q} hari, seperti chat yang cuma di-read.`,
  ],
  broken: [
    (m) => `Beruntun ${m.bestStreak} hari, lalu putus. Sayang sekali!`,
    (m) => `Rekor ${m.bestStreak} hari kandas. Apinya tinggal asap.`,
    (m) => `${m.bestStreak} hari dibangun, sehari dirobohkan. Ayo nyalakan lagi.`,
  ],
  impulse: [
    (m) => `${m.maxWantsPerDay} belanja "keinginan" dalam sehari. Keranjang belanja menangis bahagia.`,
    (m) => `${m.maxWantsPerDay} kali "cuma lihat-lihat" yang berakhir di kasir.`,
    (m) => `Sehari ${m.maxWantsPerDay} keinginan terpenuhi. Jin lampu ajaib pun kalah.`,
  ],
  night: [
    (m) => `${m.lateNight} catatan jam 12 malam ke atas. Checkout tengah malam memang menggoda.`,
    (m) => `${m.lateNight} transaksi lewat tengah malam. Flash sale jam 00.00 lagi?`,
    (m) => `Belanja jam segitu ${m.lateNight} kali. Kelelawar pun sudah tidur.`,
  ],
  snack: [
    (m) => `${m.snacksWeek} kali jajan minggu ini. Dompet: "aku juga butuh makan."`,
    (m) => `${m.snacksWeek} jajan dalam seminggu. Abang gorengan menyapa duluan.`,
    (m) => `Minggu ini ${m.snacksWeek} kali jajan. Masak di rumah kapan?`,
  ],
  fearly: [
    () => "90% anggaran habis padahal bulan masih panjang.",
    () => "Tanggal masih muda, anggaran sudah sepuh.",
    () => "Anggaran sudah 90% terpakai. Sisa hari masih banyak, sisa uang tidak.",
  ],
  fdeficit: [
    () => "Bulan lalu pengeluaran lebih besar dari pemasukan.",
    () => "Bulan lalu yang keluar lebih banyak dari yang masuk. Gali lubang, tutup lubang?",
    () => "Pengeluaran bulan lalu menyalip pemasukan. Saatnya rem tangan.",
  ],
};

export function penalties(me: MemberStats, fam: FamilyStats, seed = ""): Penalty[] {
  const quiet = me.entries > 0 && Number.isFinite(me.daysSinceLast) ? me.daysSinceLast : 0;
  // Each member gets their own line, changing every month.
  const joke = (id: string, fallback: string) => {
    const pool = PENALTY_JOKES[id];
    return pool ? pool[variantSeed(`${currentMonth()}:${seed}:${id}`) % pool.length](me, fam, quiet) : fallback;
  };
  return [
    pen("ghost", "me", "moon", "Hantu Dompet", joke("ghost", ""), "Catat satu transaksi hari ini", 15, quiet >= 3),
    pen("broken", "me", "flame", "Api Padam", joke("broken", ""), "Mulai beruntun lagi: catat 2 hari berturut-turut", 10, me.bestStreak >= 7 && me.streak < 2 && quiet >= 1),
    pen("impulse", "me", "cart", "Tangan Gatal", joke("impulse", ""), "Seminggu tanpa 4+ keinginan dalam sehari", 10, me.maxWantsPerDay >= 4),
    pen("night", "me", "moon", "Kalong Belanja", joke("night", ""), "Tidur dulu, belanjanya besok saja", 5, me.lateNight >= 3),
    pen("snack", "me", "cup", "Raja Jajan", joke("snack", ""), "Kurangi jajan jadi di bawah 10 kali seminggu", 10, me.snacksWeek >= 10),
    pen("fover", "family", "alert", "Anggaran Jebol", fam.overBudgets.length ? `${fam.overBudgets.slice(0, 2).join(", ")}${fam.overBudgets.length > 2 ? ` +${fam.overBudgets.length - 2}` : ""} sudah lewat batas.` : "Ada anggaran yang lewat batas.", "Rem belanjanya, atau ubah anggaran kalau memang kurang", 15, fam.overBudgets.length > 0),
    pen("fearly", "family", "clock", "Tanggal Tua Datang Duluan", joke("fearly", ""), "Hemat sampai akhir periode", 10, fam.earlyBurn),
    pen("fdeficit", "family", "down", "Besar Pasak daripada Tiang", joke("fdeficit", ""), "Bulan ini usahakan surplus", 15, fam.deficitLastMonth),
    pen("fbill", "family", "repeat", "Tagihan Kabur", `${fam.overdueBills} tagihan rutin lewat tanggal belum dicatat.`, "Bayar & catat tagihannya di Rutin", 10, fam.overdueBills > 0),
    pen("floan", "family", "handshake", "Utang Lupa Ingatan", `${fam.overdueLoans} pinjaman sudah lewat jatuh tempo.`, "Lunasi atau atur ulang tanggalnya di Utang & Piutang", 10, fam.overdueLoans > 0),
  ];
}

export function xpOf(me: MemberStats, list: Badge[], pens: Penalty[] = []) {
  const mine = list.filter((b) => b.unlocked && b.scope === "me").length;
  const fam = list.filter((b) => b.unlocked && b.scope === "family").length;
  const minus = pens.filter((p) => p.active).reduce((t, p) => t + p.xp, 0);
  return Math.max(0, me.entries * 2 + me.activeDays * 10 + me.receipts * 5 + me.needTags * 2 + mine * 25 + fam * 15 - minus);
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
  const pens = penalties(me, fam, member.id);
  return { me, fam, badges: list, penalties: pens, level: levelOf(xpOf(me, list, pens)) };
}

/** Lighter version for the family board (no family badges needed twice). */
export function boardFor(dompetId: string, members: Member[], fam: FamilyStats) {
  return members.map((m) => {
    const s = memberStats(dompetId, m.id);
    const pens = penalties(s, fam).filter((p) => p.active && p.scope === "me");
    return { member: m, stats: s, cards: pens.length, level: levelOf(xpOf(s, badges(s, fam), penalties(s, fam))) };
  });
}

// ---------------------------------------------------------------------------
// Lencana boros: monthly joke badges the whole family can see. Only spending
// from shared accounts counts (what everyone already sees), paid by that
// member, in the current budget month. No XP effect: just a nudge and a laugh.
// ---------------------------------------------------------------------------
export interface Boros {
  id: string;
  memberId: string;
  icon: LineIconName;
  title: string;
  joke: string;
}


/** Vars a boros line can use. */
interface BorosVars {
  amt?: string;
  date?: string;
  n?: number;
  pct?: number;
  wants?: string;
  needs?: string;
}
type Line = [title: string, joke: (v: BorosVars) => string];

/** Several wordings per badge, so two people with the same badge read differently. */
const BOROS_WORDS: Record<string, Line[]> = {
  sultan: [
    ["Sultan Sehari", (v) => `${v.amt} habis dalam sehari (${v.date}). Kaya mendadak?`],
    ["Crazy Rich Dadakan", (v) => `Tanggal ${v.date} keluar ${v.amt}. Warisan dari mana nih?`],
    ["Gesek Tanpa Ragu", (v) => `${v.amt} dalam satu hari. Kartunya sampai kepanasan.`],
    ["Raja Sehari Semalam", (v) => `${v.date}: ${v.amt} melayang. Besoknya puasa, ya?`],
    ["Dompet Kaget", (v) => `Dompetmu masih syok sejak ${v.date}. ${v.amt}, lho!`],
  ],
  kopi: [
    ["Pelanggan Setia Kopi", (v) => `${v.n} kali ngopi bulan ini (${v.amt}). Baristanya sudah hafal namamu.`],
    ["Darah Mengandung Kafein", (v) => `${v.n} gelas kopi, total ${v.amt}. Tidur kapan?`],
    ["Investor Kedai Kopi", (v) => `Sudah setor ${v.amt} ke kedai kopi. Minta saham sekalian.`],
    ["Barista Kenal Muka", (v) => `${v.n} kali mampir ngopi. Next: kopi sachet di rumah?`],
  ],
  ojol: [
    ["Langganan Ojol", (v) => `${v.n} kali naik ojol. Kaki masih berfungsi, kan?`],
    ["Penumpang VIP", (v) => `${v.n} perjalanan ojol, total ${v.amt}. Driver-nya sudah anggap saudara.`],
    ["Anti Jalan Kaki", (v) => `${v.n} kali pesan ojol. Jarak 200 meter juga dipesan?`],
    ["Sponsor Ojol", (v) => `${v.amt} untuk ojol bulan ini. Bintang 5 terus, ya.`],
  ],
  checkout: [
    ["Hobi Checkout", (v) => `${v.n} kali belanja online. Kurir sampai kenal rumahnya.`],
    ["Raja Keranjang Kuning", (v) => `${v.n} paket bulan ini. Satpam kompleks sampai bosan.`],
    ["Jempol Lincah", (v) => `${v.n} kali checkout, ${v.amt}. Jarinya lebih cepat dari pikirannya.`],
    ["Pelanggan Tetap Kurir", (v) => `${v.n} paket datang. "Paket!" sudah jadi lagu kebangsaan rumah.`],
  ],
  want: [
    ["Hati Mau, Dompet Ragu", (v) => `Belanja keinginan ${v.wants}, lebih besar dari kebutuhan ${v.needs}.`],
    ["Lapar Mata", (v) => `Keinginan ${v.wants} vs kebutuhan ${v.needs}. Matanya yang belanja.`],
    ["Yang Penting Happy", (v) => `${v.wants} untuk yang bikin senang, ${v.needs} untuk yang perlu. Seimbang? Belum.`],
    ["Self Reward Garis Keras", (v) => `Hadiah untuk diri sendiri ${v.wants}. Kerja kerasnya sepadan, kan?`],
  ],
  weekend: [
    ["Pejuang Akhir Pekan", (v) => `${v.pct}% belanjanya di Sabtu-Minggu. Weekdays hemat, weekend kalap.`],
    ["Sabtu Minggu Ceria", (v) => `${v.pct}% belanja jatuh di akhir pekan. Senin langsung insaf.`],
    ["Healing Tiap Weekend", (v) => `Akhir pekan = ${v.pct}% pengeluaran. Healing-nya mahal juga.`],
    ["Mall Weekend Club", (v) => `${v.pct}% belanja di weekend. Parkiran mall sudah reservasi?`],
  ],
  bolong: [
    ["Kantong Bolong", (v) => `Belanja naik ${v.pct}% dari bulan lalu, padahal bulan belum habis.`],
    ["Gas Pol Rem Blong", (v) => `Naik ${v.pct}% dibanding bulan lalu. Remnya di mana?`],
    ["Inflasi Pribadi", (v) => `Pengeluaranmu naik ${v.pct}%. Lebih cepat dari inflasi nasional.`],
    ["Lupa Bulan Lalu", (v) => `Bulan lalu hemat, bulan ini +${v.pct}%. Balas dendam?`],
  ],
  jajan: [
    ["Juara Jajan Keluarga", (v) => `${v.amt} untuk makan & jajan bulan ini, terbanyak di keluarga. Traktir dong!`],
    ["Duta Kuliner Rumah", (v) => `Jajan ${v.amt}, nomor satu di keluarga. Review-nya kapan?`],
    ["Perut Karet", (v) => `${v.amt} untuk makan & jajan. Yang lain masih kalah jauh.`],
    ["Food Vlogger Tanpa Kamera", (v) => `Rekor jajan keluarga: ${v.amt}. Tinggal bikin konten.`],
  ],
};

function variantSeed(key: string) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const rp = (n: number) => (n >= 1_000_000 ? `Rp${(n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}jt` : `Rp${Math.round(n / 1000)}rb`);

export function borosFor(dompetId: string, members: Member[]): Boros[] {
  const month = currentMonth();
  const { from, to } = periodRangeOf(month);
  const prev = periodRangeOf(shiftMonth(month, -1));
  const rows = all<{ paid_by: string; date: string; amount: number; note: string; merchant: string | null; need: string | null; cat: string; day: number }>(
    `SELECT t.paid_by, t.date, t.amount, t.note, t.merchant, t.need,
            lower(COALESCE(pc.name, c.name, '')) AS cat, CAST(strftime('%w', t.date) AS INTEGER) AS day
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id AND a.visibility = 'shared' AND COALESCE(a.currency, 'IDR') = 'IDR'
     LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories pc ON pc.id = c.parent_id
     WHERE t.dompet_id = ? AND t.kind = 'expense' AND t.flag IS NULL AND t.paid_by IS NOT NULL AND t.date BETWEEN ? AND ?`,
    [dompetId, from, to],
  );
  const prevTotals = new Map(
    all<{ paid_by: string; total: number }>(
      `SELECT t.paid_by, SUM(t.amount) AS total FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.visibility = 'shared' AND COALESCE(a.currency, 'IDR') = 'IDR'
       WHERE t.dompet_id = ? AND t.kind = 'expense' AND t.flag IS NULL AND t.date BETWEEN ? AND ? GROUP BY t.paid_by`,
      [dompetId, prev.from, prev.to],
    ).map((r) => [r.paid_by, r.total]),
  );
  const bills = /listrik|air|sekolah|pendidikan|cicilan|kpr|sewa|kontrak|asuransi|pulsa|internet|zakat|arisan|tagihan|kesehatan/;
  const text = (r: (typeof rows)[number]) => `${r.note} ${r.merchant ?? ""}`.toLowerCase();
  const found: { id: string; memberId: string; icon: LineIconName; vars: BorosVars }[] = [];
  const snackTotals = new Map<string, number>();

  for (const m of members) {
    const mine = rows.filter((r) => r.paid_by === m.id);
    if (mine.length === 0) continue;
    const add = (id: string, icon: LineIconName, vars: BorosVars) => found.push({ id, memberId: m.id, icon, vars });
    const total = mine.reduce((t, r) => t + r.amount, 0);
    const fun = mine.filter((r) => !bills.test(r.cat));

    // Biggest single day of non-bill spending.
    const byDay = new Map<string, number>();
    for (const r of fun) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.amount);
    const [bigDay, bigAmt] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (bigAmt >= 1_000_000) add("sultan", "star", { amt: rp(bigAmt), date: `${Number(bigDay.slice(8))}/${Number(bigDay.slice(5, 7))}` });

    const coffee = mine.filter((r) => /kopi|coffee|latte|starbucks|kenangan|janji jiwa|fore|tomoro|boba|chatime|mixue/.test(text(r)));
    if (coffee.length >= 8) add("kopi", "cup", { n: coffee.length, amt: rp(coffee.reduce((t, r) => t + r.amount, 0)) });

    const ride = mine.filter((r) => /ojol|ojek|grab|gojek|gocar|maxim|taksi|taxi/.test(text(r)));
    if (ride.length >= 10) add("ojol", "scooter", { n: ride.length, amt: rp(ride.reduce((t, r) => t + r.amount, 0)) });

    const online = mine.filter((r) => /shopee|tokopedia|lazada|tiktok shop|blibli|checkout|co\b/.test(text(r)));
    if (online.length >= 5) add("checkout", "cart", { n: online.length, amt: rp(online.reduce((t, r) => t + r.amount, 0)) });

    const wants = mine.filter((r) => r.need === "want").reduce((t, r) => t + r.amount, 0);
    const needs = mine.filter((r) => r.need === "need").reduce((t, r) => t + r.amount, 0);
    if (mine.filter((r) => r.need).length >= 5 && wants > needs) add("want", "heart", { wants: rp(wants), needs: rp(needs) });

    const weekend = fun.filter((r) => r.day === 0 || r.day === 6).reduce((t, r) => t + r.amount, 0);
    const funTotal = fun.reduce((t, r) => t + r.amount, 0);
    if (funTotal >= 500_000 && weekend / funTotal >= 0.6) add("weekend", "sparkle", { pct: Math.round((weekend / funTotal) * 100) });

    const before = prevTotals.get(m.id) ?? 0;
    if (before >= 300_000 && total >= before * 1.3 && total - before >= 300_000)
      add("bolong", "down", { pct: Math.round(((total - before) / before) * 100) });

    snackTotals.set(m.id, mine.filter((r) => /makan|jajan|food|minum/.test(r.cat)).reduce((t, r) => t + r.amount, 0));
  }

  // Family title: the biggest snacker (at least Rp300rb).
  const top = [...snackTotals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 250_000 && [...snackTotals.values()].filter((v) => v > 0).length >= 2)
    found.push({ id: "jajan", memberId: top[0], icon: "cup", vars: { amt: rp(top[1]) } });

  // Pick a wording per badge: rotates each month, and people sharing a badge
  // get different lines (in member order).
  const used = new Map<string, number>();
  return found.map((f): Boros => {
    const pool = BOROS_WORDS[f.id];
    const k = used.get(f.id) ?? 0;
    used.set(f.id, k + 1);
    const [title, joke] = pool[(variantSeed(`${month}:${f.id}`) + k) % pool.length];
    return { id: f.id, memberId: f.memberId, icon: f.icon, title, joke: joke(f.vars) };
  });
}
