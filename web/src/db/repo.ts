// Typed queries and permission-checked mutations over the SQLite database.

import { all, get, write } from "./database";
import { can, PermissionError, type Role } from "../lib/permissions";
import { currentMonth, formatIDR, parseAmount, toISODate, todayISO } from "../lib/format";
import { baseSql, CURRENCIES, formatMoney, isBase, toBase } from "../lib/currency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Dompet {
  id: string;
  name: string;
  currency: string;
  created_at: string;
}

export interface Member {
  id: string;
  dompet_id: string;
  name: string;
  role: Role;
  colour: string;
  emoji: string;
  user_id: string | null;
  phone?: string | null;
}

/** Built-in keys, or any custom group name the family typed. */
export type AccountType = "cash" | "bank" | "ewallet" | "savings" | "credit" | "investment" | (string & {});

export const BUILTIN_ACCOUNT_TYPES: { key: string; label: string; icon: string }[] = [
  { key: "cash", label: "Tunai", icon: "💵" },
  { key: "bank", label: "Bank", icon: "🏦" },
  { key: "ewallet", label: "E-wallet", icon: "📱" },
  { key: "savings", label: "Tabungan", icon: "🐷" },
  { key: "credit", label: "Kartu kredit", icon: "💳" },
  { key: "investment", label: "Investasi", icon: "📈" },
];
const BUILTIN_BY_KEY = new Map(BUILTIN_ACCOUNT_TYPES.map((t) => [t.key, t]));
/** Display name of an account type ("Bank", or the custom name as typed). */
export const accountTypeLabel = (type: string) => BUILTIN_BY_KEY.get(type)?.label ?? type;
/** Default icon for an account type. */
export const accountTypeIcon = (type: string) => BUILTIN_BY_KEY.get(type)?.icon ?? "👛";

export interface Account {
  id: string;
  dompet_id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  /** ISO code; amounts on this account are minor units of it. */
  currency: string;
  /** Rupiah per 1 unit of `currency` (1 for IDR). */
  fx_rate: number;
  colour: string;
  icon: string | null;
  visibility: "shared" | "private";
  owner_member_id: string | null;
  holder_member_id: string | null;
  holder_name: string | null;
  holder_emoji: string | null;
  holder_colour: string | null;
  /** In the account's own currency. */
  balance: number;
  /** Balance converted to rupiah, for totals. */
  balance_base: number;
}

export type Kind = "expense" | "income";

export interface Category {
  id: string;
  dompet_id: string;
  name: string;
  icon: string;
  colour: string;
  kind: Kind;
  parent_id: string | null;
}

export type TxFlag = "transfer" | "adjustment" | "loan" | null;

export interface Transaction {
  id: string;
  dompet_id: string;
  account_id: string;
  category_id: string | null;
  kind: Kind;
  amount: number;
  date: string;
  note: string;
  flag: TxFlag;
  transfer_id: string | null;
  paid_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  // joined
  account_name: string;
  account_currency: string;
  /** `amount` converted to rupiah. */
  amount_base: number;
  account_visibility: "shared" | "private";
  account_holder_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_colour: string | null;
  parent_category_name: string | null;
  paid_by_name: string | null;
  paid_by_colour: string | null;
  paid_by_emoji: string | null;
  created_by_name: string | null;
}

export interface Budget {
  id: string;
  dompet_id: string;
  name: string;
  amount: number;
  category_id: string | null;
  member_id: string | null;
  exclude_category_ids: string | null;
  /** JSON array when the budget covers several categories. */
  category_ids: string | null;
  /** Icons of the categories in category_ids (for display). */
  category_icons: string | null;
  category_name: string | null;
  category_icon: string | null;
  member_name: string | null;
  member_emoji: string | null;
  period: BudgetPeriod;
  /** Spent within the period shown (today / this week / this month). */
  spent: number;
  /** Limit for the period shown (scaled for weekly/daily in past months). */
  limit: number;
  periodLabel: string;
}

export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface Activity {
  id: string;
  member_id: string | null;
  member_name: string | null;
  member_emoji: string | null;
  member_colour: string | null;
  message: string;
  created_at: string;
}

export const MEMBER_COLOURS = ["#f47c5a", "#e5689b", "#4f8ef7", "#f5a524", "#8b74e8", "#2fb67c", "#22a6b3", "#e5484d"];
/**
 * "col IN (...)" filter with named parameters; `alsoCol` matches too
 * (used so a parent category also matches its sub-categories).
 */
function listFilter(
  col: string,
  prefix: string,
  ids: string[] | undefined,
  alsoCol: string | null,
  params: Record<string, string | number | null>,
) {
  if (!ids || ids.length === 0) return "";
  const names = ids.map((id, i) => {
    const name = "$" + prefix + i;
    params[name] = id;
    return name;
  });
  const list = names.join(",");
  return "AND (" + col + " IN (" + list + ")" + (alsoCol ? " OR " + alsoCol + " IN (" + list + ")" : "") + ")";
}

/** Spending stats ignore transfers and balance corrections. */
const REAL = `t.flag IS NULL`;
/** t.amount in rupiah (accounts joined as `a`). */
const BASE_AMOUNT = baseSql("t.amount");
/** Top-level category of a transaction (subcategories roll up). */
const TOP_CAT = `COALESCE(c.parent_id, c.id)`;

export const MEMBER_EMOJIS = ["👨", "👩", "🧑", "👧", "👦", "👴", "👵", "🧕", "🙂"];

const uid = () => crypto.randomUUID();

// A transaction is visible when its account is shared, or private and yours.
const VISIBLE_ACCOUNT = `(a.visibility = 'shared' OR a.owner_member_id = $me)`;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const q = {
  dompets: () => all<Dompet>("SELECT * FROM dompets ORDER BY created_at"),

  dompet: (id: string) => get<Dompet>("SELECT * FROM dompets WHERE id = ?", [id]),

  members: (dompetId: string) =>
    all<Member>(
      `SELECT * FROM members WHERE dompet_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, created_at`,
      [dompetId],
    ),

  member: (id: string) => get<Member>("SELECT * FROM members WHERE id = ?", [id]),

  accounts: (dompetId: string, me: string) =>
    all<Omit<Account, "balance_base">>(
      `SELECT a.*, h.name AS holder_name, h.emoji AS holder_emoji, h.colour AS holder_colour,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
           FROM transactions t WHERE t.account_id = a.id), 0) AS balance
       FROM accounts a
       LEFT JOIN members h ON h.id = COALESCE(a.holder_member_id, a.owner_member_id)
       WHERE a.dompet_id = $d AND a.archived = 0 AND ${VISIBLE_ACCOUNT}
       ORDER BY a.visibility = 'private', a.created_at`,
      { $d: dompetId, $me: me },
    ).map((a): Account => ({ ...a, currency: a.currency || "IDR", fx_rate: a.fx_rate ?? 1, balance_base: toBase(a.balance, a.currency, a.fx_rate) })),

  /** Custom account types already used in this Dompet (for the type picker). */
  customAccountTypes: (dompetId: string) =>
    all<{ type: string }>("SELECT DISTINCT type FROM accounts WHERE dompet_id = ? ORDER BY type", [dompetId])
      .map((r) => r.type)
      .filter((t) => !BUILTIN_BY_KEY.has(t)),

  categories: (dompetId: string, kind?: Kind) =>
    all<Category>(
      `SELECT * FROM categories WHERE dompet_id = $d AND ($k IS NULL OR kind = $k)
       ORDER BY kind DESC, parent_id IS NOT NULL, sort_order, name`,
      { $d: dompetId, $k: kind ?? null },
    ),

  transactions(
    dompetId: string,
    me: string,
    f: {
      month?: string;
      paidBy?: string;
      categoryId?: string;
      accountId?: string;
      kind?: Kind;
      limit?: number;
      search?: string;
      /** Any of these categories (a parent also matches its sub-categories). */
      categoryIds?: string[];
      accountIds?: string[];
      paidByIds?: string[];
    } = {},
  ) {
    // Free-text search: every word must match a note, category, sub-category,
    // account or payer name, or an amount ("50rb", "186000", "1,5jt").
    const terms = (f.search ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const termSql = terms
      .map(
        (_, i) => `AND (
          lower(t.note) LIKE $t${i} OR lower(COALESCE(c.name, '')) LIKE $t${i} OR lower(COALESCE(pc.name, '')) LIKE $t${i}
          OR lower(a.name) LIKE $t${i} OR lower(COALESCE(p.name, '')) LIKE $t${i}
          OR ($n${i} IS NOT NULL AND (t.amount = $n${i} OR CAST(t.amount AS TEXT) LIKE $d${i})))`,
      )
      .join("\n");
    const termParams: Record<string, string | number | null> = {};
    terms.forEach((term, i) => {
      termParams[`$t${i}`] = `%${term.replace(/[%_]/g, "")}%`;
      const n = parseAmount(term);
      const digits = term.replace(/\D/g, "");
      termParams[`$n${i}`] = Number.isFinite(n) && n > 0 ? n : null;
      termParams[`$d${i}`] = digits.length >= 3 ? `%${digits}%` : "__no_match__";
    });
    return all<Transaction>(
      `SELECT t.*, a.name AS account_name, COALESCE(a.currency, 'IDR') AS account_currency, ${baseSql("t.amount")} AS amount_base,
              a.visibility AS account_visibility,
              COALESCE(a.holder_member_id, a.owner_member_id) AS account_holder_id,
              c.name AS category_name, COALESCE(c.icon, pc.icon) AS category_icon,
              COALESCE(pc.colour, c.colour) AS category_colour, pc.name AS parent_category_name,
              p.name AS paid_by_name, p.colour AS paid_by_colour, p.emoji AS paid_by_emoji,
              cb.name AS created_by_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN members p ON p.id = t.paid_by
       LEFT JOIN members cb ON cb.id = t.created_by
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT}
         AND ($month IS NULL OR substr(t.date, 1, 7) = $month)
         AND ($paid IS NULL OR t.paid_by = $paid)
         AND ($cat IS NULL OR t.category_id = $cat OR c.parent_id = $cat)
         AND ($acc IS NULL OR t.account_id = $acc)
         AND ($kind IS NULL OR t.kind = $kind)
         ${termSql}
         ${listFilter("t.category_id", "cat", f.categoryIds, "c.parent_id", termParams)}
         ${listFilter("t.account_id", "acc", f.accountIds, null, termParams)}
         ${listFilter("t.paid_by", "pay", f.paidByIds, null, termParams)}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT $limit`,
      {
        $d: dompetId,
        $me: me,
        $month: f.month ?? null,
        $paid: f.paidBy ?? null,
        $cat: f.categoryId ?? null,
        $acc: f.accountId ?? null,
        $kind: f.kind ?? null,
        $limit: f.limit ?? -1,
        ...termParams,
      },
    );
  },

  /**
   * Earlier transactions whose name matches what's being typed, to fill a new
   * one from. One suggestion per (name, category, account), newest first;
   * names starting with the text rank above names merely containing it.
   */
  suggestions(dompetId: string, me: string, text: string, limit = 5, kind?: Kind) {
    const needle = text.trim().toLowerCase();
    if (needle.length < 2) return [];
    const rows = all<{
      note: string;
      kind: Kind;
      amount: number;
      category_id: string | null;
      account_id: string;
      paid_by: string | null;
      date: string;
      category_icon: string | null;
      category_name: string | null;
      account_name: string;
      account_currency: string;
      account_visibility: "shared" | "private";
      paid_by_name: string | null;
    }>(
      `SELECT t.note, t.kind, t.amount, t.category_id, t.account_id, t.paid_by, t.date,
              COALESCE(c.icon, pc.icon) AS category_icon, c.name AS category_name,
              a.name AS account_name, COALESCE(a.currency, 'IDR') AS account_currency, a.visibility AS account_visibility, p.name AS paid_by_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN members p ON p.id = t.paid_by
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND a.archived = 0 AND t.flag IS NULL
         AND t.note <> '' AND lower(t.note) LIKE $like
         AND ($kind IS NULL OR t.kind = $kind)
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 300`,
      { $d: dompetId, $me: me, $like: "%" + needle.replace(/[%_]/g, "") + "%", $kind: kind ?? null },
    );
    const seen = new Map<string, (typeof rows)[number] & { uses: number }>();
    for (const r of rows) {
      const key = r.note.toLowerCase() + "|" + (r.category_id ?? "") + "|" + r.account_id;
      const hit = seen.get(key);
      if (hit) hit.uses += 1;
      else seen.set(key, { ...r, uses: 1 }); // first = most recent amount/payer
    }
    return [...seen.values()]
      .sort((a, b) => Number(b.note.toLowerCase().startsWith(needle)) - Number(a.note.toLowerCase().startsWith(needle)))
      .slice(0, limit);
  },

  /** Both sides (and the fee, if any) of a transfer. */
  transfer(dompetId: string, transferId: string) {
    const rows = all<{ id: string; account_id: string; kind: Kind; amount: number; date: string; note: string; flag: TxFlag; created_by: string | null }>(
      "SELECT id, account_id, kind, amount, date, note, flag, created_by FROM transactions WHERE dompet_id = ? AND transfer_id = ?",
      [dompetId, transferId],
    );
    const out = rows.find((r) => r.flag === "transfer" && r.kind === "expense");
    const into = rows.find((r) => r.flag === "transfer" && r.kind === "income");
    const fee = rows.find((r) => r.flag === null && r.kind === "expense");
    if (!out || !into) return null;
    return {
      transferId,
      fromAccountId: out.account_id,
      toAccountId: into.account_id,
      amount: out.amount,
      /** Amount received (differs from `amount` across currencies). */
      toAmount: into.amount,
      fee: fee?.amount ?? 0,
      date: out.date,
      note: out.note.replace(/^Transfer( ke [^·]+)?( · )?/, ""),
      createdBy: out.created_by,
    };
  },

  monthTotals(dompetId: string, me: string, month: string) {
    return (
      get<{ income: number; expense: number }>(
        `SELECT COALESCE(SUM(CASE WHEN t.kind='income' THEN ${BASE_AMOUNT} END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind='expense' THEN ${BASE_AMOUNT} END), 0) AS expense
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND substr(t.date, 1, 7) = $month`,
        { $d: dompetId, $me: me, $month: month },
      ) ?? { income: 0, expense: 0 }
    );
  },

  spendingByMember(dompetId: string, me: string, month: string) {
    return all<{ id: string; name: string; emoji: string; colour: string; total: number }>(
      `SELECT m.id, m.name, m.emoji, m.colour,
              COALESCE(SUM(${BASE_AMOUNT}), 0) AS total
       FROM members m
       LEFT JOIN (transactions t JOIN accounts a ON a.id = t.account_id AND a.dompet_id = $d AND ${VISIBLE_ACCOUNT})
         ON t.paid_by = m.id AND t.kind = 'expense' AND ${REAL}
         AND substr(t.date, 1, 7) = $month
       WHERE m.dompet_id = $d
       GROUP BY m.id ORDER BY total DESC`,
      { $d: dompetId, $me: me, $month: month },
    );
  },

  spendingByCategory(dompetId: string, me: string, month: string) {
    return all<{ id: string | null; name: string; icon: string; colour: string; total: number }>(
      `SELECT top.id, COALESCE(top.name, 'Tanpa kategori') AS name, COALESCE(top.icon, '📦') AS icon,
              COALESCE(top.colour, '#b29d8b') AS colour, SUM(${BASE_AMOUNT}) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories top ON top.id = ${TOP_CAT}
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND t.kind = 'expense'
         AND substr(t.date, 1, 7) = $month
       GROUP BY top.id ORDER BY total DESC`,
      { $d: dompetId, $me: me, $month: month },
    );
  },

  /** Budgets count shared-account spending only, so every member sees the same progress. */
  /**
   * Budgets with progress for the period that matters when viewing `month`:
   * in the current month a daily budget tracks today and a weekly one this
   * week (Mon-Sun); for past months they show the whole month against the
   * equivalent limit (amount x days/7 or x days).
   */
  budgets(dompetId: string, month: string, opts: { wholeMonth?: boolean } = {}) {
    // wholeMonth: month-to-date spending against the monthly-equivalent limit,
    // for every period (used by forecasts).
    const isCurrent = month === currentMonth() && !opts.wholeMonth;
    const [y, mo] = month.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate();
    const monthFrom = month + "-01";
    const monthTo = month + "-" + String(daysInMonth).padStart(2, "0");
    const today = todayISO();
    const now = new Date();
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const weekFrom = toISODate(monday);
    const weekTo = toISODate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
    const rows = all<Omit<Budget, "limit" | "periodLabel">>(
      `SELECT b.*, COALESCE(c.name, (SELECT group_concat(x.name, ', ') FROM json_each(b.category_ids) j JOIN categories x ON x.id = j.value)) AS category_name,
              c.icon AS category_icon,
              (SELECT json_group_array(x.icon) FROM json_each(b.category_ids) j JOIN categories x ON x.id = j.value) AS category_icons,
              m.name AS member_name, m.emoji AS member_emoji,
              COALESCE((
                SELECT SUM(${BASE_AMOUNT}) FROM transactions t
                JOIN accounts a ON a.id = t.account_id AND a.visibility = 'shared'
                LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.dompet_id = b.dompet_id AND t.kind = 'expense' AND ${REAL}
                  AND t.date BETWEEN
                        (CASE WHEN $current = 1 AND b.period = 'weekly' THEN $weekFrom
                              WHEN $current = 1 AND b.period = 'daily' THEN $today
                              ELSE $monthFrom END)
                    AND (CASE WHEN $current = 1 AND b.period = 'weekly' THEN $weekTo
                              WHEN $current = 1 AND b.period = 'daily' THEN $today
                              ELSE $monthTo END)
                  AND ((b.category_id IS NULL AND b.category_ids IS NULL)
                       OR t.category_id = b.category_id OR c.parent_id = b.category_id
                       OR COALESCE(t.category_id, '') IN (SELECT value FROM json_each(COALESCE(b.category_ids, '[]')))
                       OR COALESCE(c.parent_id, '') IN (SELECT value FROM json_each(COALESCE(b.category_ids, '[]'))))
                  AND (b.exclude_category_ids IS NULL OR (
                        COALESCE(t.category_id, '') NOT IN (SELECT value FROM json_each(b.exclude_category_ids))
                    AND COALESCE(c.parent_id, '') NOT IN (SELECT value FROM json_each(b.exclude_category_ids))))
                  AND (b.member_id IS NULL OR t.paid_by = b.member_id)
              ), 0) AS spent
       FROM budgets b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN members m ON m.id = b.member_id
       WHERE b.dompet_id = $d
       ORDER BY CASE b.period WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END,
                b.member_id IS NOT NULL, b.category_id IS NOT NULL, b.name`,
      { $d: dompetId, $current: isCurrent ? 1 : 0, $weekFrom: weekFrom, $weekTo: weekTo, $today: today, $monthFrom: monthFrom, $monthTo: monthTo },
    );
    const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
    return rows.map((b): Budget => {
      const period = (b.period ?? "monthly") as BudgetPeriod;
      if (period === "monthly") return { ...b, period, limit: b.amount, periodLabel: "Bulan ini" };
      if (!isCurrent) {
        const factor = period === "weekly" ? daysInMonth / 7 : daysInMonth;
        return { ...b, period, limit: Math.round(b.amount * factor), periodLabel: "Sebulan (setara)" };
      }
      return {
        ...b,
        period,
        limit: b.amount,
        periodLabel: period === "daily" ? "Hari ini" : `Minggu ini (${dayFmt.format(monday)}–${dayFmt.format(new Date(weekTo + "T00:00"))})`,
      };
    });
  },

  /** Income/expense per month, oldest first, for the last `months` months. */
  monthlySeries(dompetId: string, me: string, months: string[]) {
    const rows = all<{ month: string; income: number; expense: number }>(
      `SELECT substr(t.date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN t.kind='income' THEN ${BASE_AMOUNT} END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind='expense' THEN ${BASE_AMOUNT} END), 0) AS expense
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL}
         AND substr(t.date, 1, 7) BETWEEN $from AND $to
       GROUP BY month`,
      { $d: dompetId, $me: me, $from: months[0], $to: months[months.length - 1] },
    );
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    return months.map((m) => byMonth.get(m) ?? { month: m, income: 0, expense: 0 });
  },

  /** Expense per day of a month: [{ day: 1..31, total }]. */
  dailyExpense(dompetId: string, me: string, month: string) {
    return all<{ day: number; total: number }>(
      `SELECT CAST(substr(t.date, 9, 2) AS INTEGER) AS day, SUM(${BASE_AMOUNT}) AS total
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND t.kind = 'expense'
         AND substr(t.date, 1, 7) = $month
       GROUP BY day ORDER BY day`,
      { $d: dompetId, $me: me, $month: month },
    );
  },

  /** Net balance change (all flows, incl. transfers) per month from `from` onward. */
  netChangeSince(dompetId: string, me: string, from: string) {
    return all<{ month: string; net: number }>(
      `SELECT substr(t.date, 1, 7) AS month,
              SUM(CASE t.kind WHEN 'income' THEN ${BASE_AMOUNT} ELSE -${BASE_AMOUNT} END) AS net
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND substr(t.date, 1, 7) >= $from
       GROUP BY month`,
      { $d: dompetId, $me: me, $from: from },
    );
  },

  activity: (dompetId: string, limit = 12) =>
    all<Activity>(
      `SELECT ac.id, ac.member_id, ac.message, ac.created_at,
              m.name AS member_name, m.emoji AS member_emoji, m.colour AS member_colour
       FROM activity ac LEFT JOIN members m ON m.id = ac.member_id
       WHERE ac.dompet_id = ? ORDER BY ac.created_at DESC, ac.rowid DESC LIMIT ?`,
      [dompetId, limit],
    ),
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
type Run = (sql: string, params?: Record<string, string | number | null> | (string | number | null)[]) => void;

function actorOf(actorId: string): Member {
  const m = q.member(actorId);
  if (!m) throw new PermissionError("Pilih anggota dulu.");
  return m;
}

function log(run: Run, actor: Member, message: string) {
  run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [
    uid(),
    actor.dompet_id,
    actor.id,
    message,
  ]);
}

function requireText(value: string, label: string, max = 40) {
  const v = value.trim();
  if (!v) throw new Error(`${label} wajib diisi.`);
  if (v.length > max) throw new Error(`${label} maksimal ${max} karakter.`);
  return v;
}

export const DEFAULT_CATEGORIES: { name: string; icon: string; colour: string; kind: Kind }[] = [
  { name: "Makan & Minum", icon: "🍜", colour: "#f97316", kind: "expense" },
  { name: "Belanja Dapur", icon: "🛒", colour: "#16a34a", kind: "expense" },
  { name: "Transportasi", icon: "🛵", colour: "#2563eb", kind: "expense" },
  { name: "Listrik & Air", icon: "💡", colour: "#eab308", kind: "expense" },
  { name: "Pulsa & Internet", icon: "📶", colour: "#06b6d4", kind: "expense" },
  { name: "Sekolah", icon: "🎒", colour: "#8b5cf6", kind: "expense" },
  { name: "Kesehatan", icon: "💊", colour: "#ef4444", kind: "expense" },
  { name: "Hiburan", icon: "🎬", colour: "#ec4899", kind: "expense" },
  { name: "Arisan", icon: "🤝", colour: "#14b8a6", kind: "expense" },
  { name: "Zakat & Sedekah", icon: "🤲", colour: "#84cc16", kind: "expense" },
  { name: "Lainnya", icon: "📦", colour: "#94a3b8", kind: "expense" },
  { name: "Gaji", icon: "💼", colour: "#0f766e", kind: "income" },
  { name: "Bonus", icon: "🎁", colour: "#d97706", kind: "income" },
  { name: "Usaha", icon: "🏪", colour: "#7c3aed", kind: "income" },
  { name: "Pemasukan Lain", icon: "💰", colour: "#64748b", kind: "income" },
];

/** Inserts a Dompet with its owner, default categories and a cash account. */
export function insertDompet(run: Run, name: string, ownerName: string, ownerEmoji = "🙂") {
  const dompetId = uid();
  const ownerId = uid();
  run("INSERT INTO dompets (id, name) VALUES (?, ?)", [dompetId, requireText(name, "Nama Dompet", 80)]);
  run("INSERT INTO members (id, dompet_id, name, role, colour, emoji) VALUES (?, ?, ?, 'owner', ?, ?)", [
    ownerId,
    dompetId,
    requireText(ownerName, "Nama kamu"),
    MEMBER_COLOURS[0],
    ownerEmoji,
  ]);
  const categoryIds: Record<string, string> = {};
  DEFAULT_CATEGORIES.forEach((c, i) => {
    const id = uid();
    categoryIds[c.name] = id;
    run("INSERT INTO categories (id, dompet_id, name, icon, colour, kind, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      id,
      dompetId,
      c.name,
      c.icon,
      c.colour,
      c.kind,
      i,
    ]);
  });
  const cashId = uid();
  run(
    "INSERT INTO accounts (id, dompet_id, name, type, colour, created_by) VALUES (?, ?, 'Dompet Tunai', 'cash', '#0f766e', ?)",
    [cashId, dompetId, ownerId],
  );
  return { dompetId, ownerId, cashId, categoryIds };
}

export const m = {
  createDompet(name: string, ownerName: string, ownerEmoji?: string) {
    return write((run) => {
      const ids = insertDompet(run, name, ownerName, ownerEmoji);
      run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [
        uid(),
        ids.dompetId,
        ids.ownerId,
        `membuat Dompet "${name.trim()}"`,
      ]);
      return ids;
    });
  },

  renameDompet(actorId: string, name: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    return write((run) => {
      run("UPDATE dompets SET name = ? WHERE id = ?", [requireText(name, "Nama Dompet", 80), actor.dompet_id]);
      log(run, actor, `mengganti nama Dompet menjadi "${name.trim()}"`);
    });
  },

  deleteDompet(actorId: string) {
    const actor = actorOf(actorId);
    if (!can.deleteDompet(actor.role)) throw new PermissionError("Hanya pemilik yang bisa menghapus Dompet.");
    return write((run) => run("DELETE FROM dompets WHERE id = ?", [actor.dompet_id]));
  },

  // --- members -------------------------------------------------------------
  addMember(actorId: string, data: { name: string; role: Role; emoji: string }) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    if (data.role === "owner" && actor.role !== "owner") throw new PermissionError("Hanya pemilik yang bisa menambah pemilik.");
    if (data.role === "admin" && actor.role !== "owner") throw new PermissionError("Hanya pemilik yang bisa menambah admin.");
    const count = q.members(actor.dompet_id).length;
    return write((run) => {
      const id = uid();
      const name = requireText(data.name, "Nama");
      run("INSERT INTO members (id, dompet_id, name, role, colour, emoji) VALUES (?, ?, ?, ?, ?, ?)", [
        id,
        actor.dompet_id,
        name,
        data.role,
        MEMBER_COLOURS[count % MEMBER_COLOURS.length],
        data.emoji,
      ]);
      log(run, actor, `menambahkan ${name} sebagai anggota`);
      return id;
    });
  },

  updateMemberProfile(actorId: string, targetId: string, data: { name: string; emoji: string }) {
    const actor = actorOf(actorId);
    if (actor.id !== targetId && !can.manage(actor.role)) throw new PermissionError();
    return write((run) => {
      run("UPDATE members SET name = ?, emoji = ? WHERE id = ? AND dompet_id = ?", [
        requireText(data.name, "Nama"),
        data.emoji,
        targetId,
        actor.dompet_id,
      ]);
    });
  },

  setMemberRole(actorId: string, targetId: string, role: Role) {
    const actor = actorOf(actorId);
    const target = actorOf(targetId);
    if (target.dompet_id !== actor.dompet_id) throw new PermissionError();
    if (!can.assignableRoles(actor.role, target.role).includes(role)) throw new PermissionError();
    if (target.role === "owner" && role !== "owner") {
      const owners = q.members(actor.dompet_id).filter((x) => x.role === "owner").length;
      if (owners <= 1) throw new Error("Dompet harus punya minimal satu pemilik. Jadikan orang lain pemilik dulu.");
    }
    return write((run) => {
      run("UPDATE members SET role = ? WHERE id = ?", [role, targetId]);
      log(run, actor, `mengubah peran ${target.name} menjadi ${role}`);
    });
  },

  removeMember(actorId: string, targetId: string) {
    const actor = actorOf(actorId);
    const target = actorOf(targetId);
    if (target.dompet_id !== actor.dompet_id) throw new PermissionError();
    if (!can.removeMember(actor.role, target.role, actor.id === target.id)) throw new PermissionError();
    return write((run) => {
      // Their private accounts go with them; shared history stays (paid_by becomes NULL).
      run("DELETE FROM accounts WHERE visibility = 'private' AND owner_member_id = ?", [targetId]);
      run("DELETE FROM members WHERE id = ?", [targetId]);
      log(run, actor, `mengeluarkan ${target.name} dari Dompet`);
    });
  },

  // --- accounts ------------------------------------------------------------
  saveAccount(
    actorId: string,
    data: {
      id?: string; name: string; type: AccountType; opening_balance: number; colour: string; icon?: string | null;
      visibility: "shared" | "private"; holder_member_id?: string | null; currency?: string; fx_rate?: number;
    },
  ) {
    const actor = actorOf(actorId);
    const existing = data.id
      ? get<{ visibility: "shared" | "private"; owner_member_id: string | null; holder_member_id: string | null }>(
          "SELECT visibility, owner_member_id, holder_member_id FROM accounts WHERE id = ?",
          [data.id],
        )
      : undefined;
    const ownsPrivate = data.visibility === "private" && (!existing || existing.owner_member_id === actor.id);
    const holdsShared = !!existing && existing.visibility === "shared" && existing.holder_member_id === actor.id && data.visibility === "shared";
    if (!(can.manage(actor.role) || holdsShared || (ownsPrivate && can.addPrivateAccount(actor.role)))) throw new PermissionError();
    if (!Number.isFinite(data.opening_balance)) throw new Error("Saldo awal tidak valid.");
    const name = requireText(data.name, "Nama akun");
    const type = requireText(data.type, "Jenis akun", 30);
    const currency = data.currency ?? "IDR";
    if (!CURRENCIES.some((c) => c.code === currency)) throw new Error("Mata uang tidak didukung.");
    const fxRate = isBase(currency) ? 1 : (data.fx_rate ?? NaN);
    if (!Number.isFinite(fxRate) || fxRate <= 0) throw new Error("Isi kurs ke Rupiah (lebih dari 0).");
    return write((run) => {
      if (data.id) {
        run(
          `UPDATE accounts SET name = ?, type = ?, opening_balance = ?, colour = ?, icon = ?, visibility = ?, currency = ?, fx_rate = ?,
             owner_member_id = CASE WHEN ? = 'private' THEN COALESCE(owner_member_id, ?) ELSE NULL END
           WHERE id = ? AND dompet_id = ?`,
          [name, type, data.opening_balance, data.colour, data.icon ?? null, data.visibility, currency, fxRate, data.visibility, actor.id, data.id, actor.dompet_id],
        );
        // Holder changes on shared accounts are an admin decision.
        if (can.manage(actor.role) && data.visibility === "shared" && data.holder_member_id !== undefined) {
          run("UPDATE accounts SET holder_member_id = ? WHERE id = ? AND dompet_id = ?", [data.holder_member_id, data.id, actor.dompet_id]);
        }
        log(run, actor, `mengubah akun ${name}`);
      } else {
        run(
          `INSERT INTO accounts (id, dompet_id, name, type, opening_balance, currency, fx_rate, colour, icon, visibility, owner_member_id, holder_member_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uid(), actor.dompet_id, name, type, data.opening_balance, currency, fxRate, data.colour, data.icon ?? null, data.visibility,
            data.visibility === "private" ? actor.id : null,
            data.visibility === "private" ? actor.id : (data.holder_member_id ?? null),
            actor.id,
          ],
        );
        if (data.visibility === "shared") log(run, actor, `menambahkan akun ${name}`);
      }
    });
  },

  /**
   * Balance correction: set the account to its real balance (from the bank app)
   * by recording the difference as an 'adjustment' (not spending or income).
   */
  correctBalance(actorId: string, accountId: string, actualBalance: number, date: string) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa mengoreksi saldo.");
    if (!Number.isFinite(actualBalance)) throw new Error("Saldo tidak valid.");
    const acc = q.accounts(actor.dompet_id, actor.id).find((a) => a.id === accountId);
    if (!acc) throw new Error("Akun tidak ditemukan.");
    const diff = Math.round(actualBalance) - acc.balance;
    if (diff === 0) throw new Error("Saldo sudah sama, tidak perlu dikoreksi.");
    return write((run) => {
      run(
        `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, paid_by, created_by, updated_by)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'Koreksi saldo', 'adjustment', ?, ?, ?)`,
        [uid(), actor.dompet_id, accountId, diff > 0 ? "income" : "expense", Math.abs(diff), date, actor.id, actor.id, actor.id],
      );
      if (acc.visibility === "shared")
        log(run, actor, `mengoreksi saldo ${acc.name} menjadi ${formatMoney(Math.round(actualBalance), acc.currency)} (${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff), acc.currency)})`);
      return diff;
    });
  },

  /**
   * Hand an account to a member (null = the whole family). Mirrors the
   * assign_account() database function used in cloud mode.
   */
  assignAccount(actorId: string, accountId: string, memberId: string | null, visibility: "shared" | "private", reassignPaidBy: boolean) {
    const actor = actorOf(actorId);
    const acc = get<{ name: string; visibility: string; owner_member_id: string | null }>(
      "SELECT name, visibility, owner_member_id FROM accounts WHERE id = ? AND dompet_id = ?",
      [accountId, actor.dompet_id],
    );
    if (!acc) throw new Error("Akun tidak ditemukan.");
    const ownsPrivate = acc.visibility === "private" && acc.owner_member_id === actor.id;
    if (!can.manage(actor.role) && !ownsPrivate) throw new PermissionError();
    if (visibility === "shared" && !can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa membuat akun bersama.");
    if (visibility === "private" && !memberId) throw new Error("Akun pribadi harus punya pemegang.");
    const target = memberId ? q.member(memberId) : null;
    if (memberId && (!target || target.dompet_id !== actor.dompet_id)) throw new Error("Anggota itu tidak ada di Dompet ini.");
    return write((run) => {
      run("UPDATE accounts SET visibility = ?, owner_member_id = ?, holder_member_id = ? WHERE id = ?", [
        visibility, visibility === "private" ? memberId : null, memberId, accountId,
      ]);
      let moved = 0;
      if (reassignPaidBy && memberId) {
        moved = get<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE account_id = ? AND flag IS NULL AND paid_by IS NOT ?", [accountId, memberId])?.n ?? 0;
        run("UPDATE transactions SET paid_by = ?, updated_by = ?, updated_at = datetime('now') WHERE account_id = ? AND flag IS NULL AND paid_by IS NOT ?", [
          memberId, actor.id, accountId, memberId,
        ]);
      }
      if (target) log(run, actor, `menyerahkan akun ${acc.name} kepada ${target.name}`);
      return moved;
    });
  },

  deleteAccount(actorId: string, accountId: string) {
    const actor = actorOf(actorId);
    const acc = get<{ name: string; visibility: string; owner_member_id: string | null }>(
      "SELECT name, visibility, owner_member_id FROM accounts WHERE id = ? AND dompet_id = ?",
      [accountId, actor.dompet_id],
    );
    if (!acc) return Promise.resolve();
    const mine = acc.visibility === "private" && acc.owner_member_id === actor.id;
    if (!can.manage(actor.role) && !mine) throw new PermissionError();
    return write((run) => {
      run("DELETE FROM accounts WHERE id = ?", [accountId]);
      if (acc.visibility === "shared") log(run, actor, `menghapus akun ${acc.name} beserta transaksinya`);
    });
  },

  // --- categories ----------------------------------------------------------
  /** Create or edit a category; `parent_id` makes it a subcategory (one level). */
  saveCategory(
    actorId: string,
    data: { id?: string; name: string; icon: string; kind: Kind; colour: string; parent_id: string | null },
  ) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengatur kategori.");
    const name = requireText(data.name, "Nama kategori");
    if (data.parent_id) {
      const parent = get<{ kind: Kind; parent_id: string | null; dompet_id: string }>(
        "SELECT kind, parent_id, dompet_id FROM categories WHERE id = ?",
        [data.parent_id],
      );
      if (!parent || parent.dompet_id !== actor.dompet_id) throw new Error("Kategori induk tidak ditemukan.");
      if (parent.parent_id) throw new Error("Subkategori hanya bisa satu tingkat.");
      if (parent.kind !== data.kind) throw new Error("Jenis subkategori harus sama dengan induknya.");
      if (data.id && data.id === data.parent_id) throw new Error("Kategori tidak bisa jadi induk dirinya sendiri.");
      if (data.id && get("SELECT 1 FROM categories WHERE parent_id = ?", [data.id]))
        throw new Error("Kategori ini punya subkategori, jadi tidak bisa dijadikan subkategori.");
    }
    return write((run) => {
      if (data.id) {
        run("UPDATE categories SET name = ?, icon = ?, colour = ?, kind = ?, parent_id = ? WHERE id = ? AND dompet_id = ?", [
          name, data.icon || "📦", data.colour, data.kind, data.parent_id, data.id, actor.dompet_id,
        ]);
        // Subcategories follow their parent's kind.
        run("UPDATE categories SET kind = ? WHERE parent_id = ?", [data.kind, data.id]);
      } else {
        run("INSERT INTO categories (id, dompet_id, name, icon, colour, kind, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 99)", [
          uid(), actor.dompet_id, name, data.icon || "📦", data.colour, data.kind, data.parent_id,
        ]);
        log(run, actor, `menambahkan ${data.parent_id ? "subkategori" : "kategori"} ${name}`);
      }
    });
  },

  deleteCategory(actorId: string, categoryId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    return write((run) => run("DELETE FROM categories WHERE id = ? AND dompet_id = ?", [categoryId, actor.dompet_id]));
  },

  // --- transactions --------------------------------------------------------
  saveTransaction(
    actorId: string,
    data: { id?: string; kind: Kind; amount: number; account_id: string; category_id: string | null; date: string; note: string; paid_by: string },
  ) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa mencatat transaksi.");
    if (!Number.isInteger(data.amount) || data.amount <= 0) throw new Error("Jumlah harus lebih dari 0.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Tanggal tidak valid.");
    const acc = get<{ visibility: string; owner_member_id: string | null; currency: string }>(
      "SELECT visibility, owner_member_id, currency FROM accounts WHERE id = ? AND dompet_id = ?",
      [data.account_id, actor.dompet_id],
    );
    if (!acc) throw new Error("Pilih akun.");
    if (acc.visibility === "private" && acc.owner_member_id !== actor.id) throw new PermissionError("Itu akun pribadi orang lain.");
    const note = data.note.trim().slice(0, 140);

    if (data.id) {
      const existing = get<{ created_by: string | null; holder: string | null }>(
        "SELECT t.created_by, COALESCE(a.holder_member_id, a.owner_member_id) AS holder FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.dompet_id = ?",
        [data.id, actor.dompet_id],
      );
      if (!existing) throw new Error("Transaksi tidak ditemukan.");
      if (!can.editTransaction(actor.role, existing.created_by === actor.id, existing.holder === actor.id))
        throw new PermissionError("Anggota hanya bisa mengubah catatan sendiri.");
    }

    const cat = data.category_id ? get<{ name: string; icon: string }>("SELECT name, icon FROM categories WHERE id = ?", [data.category_id]) : undefined;
    const payer = q.member(data.paid_by);
    const what = `${data.kind === "expense" ? "pengeluaran" : "pemasukan"} ${formatMoney(data.amount, acc.currency)}${cat ? ` · ${cat.icon} ${cat.name}` : ""}${payer && payer.id !== actor.id ? ` (dibayar ${payer.name})` : ""}`;

    return write((run) => {
      if (data.id) {
        run(
          `UPDATE transactions SET kind = ?, amount = ?, account_id = ?, category_id = ?, date = ?, note = ?,
             paid_by = ?, updated_by = ?, updated_at = datetime('now')
           WHERE id = ? AND dompet_id = ?`,
          [data.kind, data.amount, data.account_id, data.category_id, data.date, note, data.paid_by, actor.id, data.id, actor.dompet_id],
        );
        if (acc.visibility === "shared") log(run, actor, `mengubah ${what}`);
      } else {
        run(
          `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), actor.dompet_id, data.account_id, data.category_id, data.kind, data.amount, data.date, note, data.paid_by, actor.id, actor.id],
        );
        if (acc.visibility === "shared") log(run, actor, `mencatat ${what}`);
      }
    });
  },

  /**
   * Move money between two accounts: an outgoing and an incoming transaction
   * flagged 'transfer' (balances move, spending stats don't), plus an optional
   * admin fee as a normal expense from the source account. Editing replaces
   * the whole group.
   */
  saveTransfer(
    actorId: string,
    data: {
      transferId?: string; fromAccountId: string; toAccountId: string; amount: number; fee: number; date: string; note: string;
      /** Amount received, in the destination's currency (only when currencies differ). */
      toAmount?: number;
    },
  ) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa membuat transfer.");
    if (!Number.isInteger(data.amount) || data.amount <= 0) throw new Error("Jumlah harus lebih dari 0.");
    if (!Number.isInteger(data.fee) || data.fee < 0) throw new Error("Biaya admin tidak valid.");
    if (data.fromAccountId === data.toAccountId) throw new Error("Pilih dua akun yang berbeda.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Tanggal tidak valid.");
    const visible = q.accounts(actor.dompet_id, actor.id);
    const from = visible.find((a) => a.id === data.fromAccountId);
    const to = visible.find((a) => a.id === data.toAccountId);
    if (!from || !to) throw new Error("Pilih akun asal dan tujuan.");
    for (const a of [from, to]) {
      if (a.visibility === "private" && a.owner_member_id !== actor.id) throw new PermissionError("Itu akun pribadi orang lain.");
    }
    const sameCurrency = from.currency === to.currency;
    const toAmount = sameCurrency ? data.amount : (data.toAmount ?? NaN);
    if (!Number.isInteger(toAmount) || toAmount <= 0) throw new Error(`Isi jumlah yang diterima di ${to.name}.`);
    if (data.transferId) {
      const existing = q.transfer(actor.dompet_id, data.transferId);
      if (!existing) throw new Error("Transfer tidak ditemukan.");
      const holder = (id: string) => visible.find((a) => a.id === id)?.holder_member_id === actor.id;
      if (!can.editTransaction(actor.role, existing.createdBy === actor.id, holder(existing.fromAccountId) || holder(existing.toAccountId)))
        throw new PermissionError("Anggota hanya bisa mengubah transfer sendiri.");
    }
    const transferId = data.transferId ?? uid();
    const extra = data.note.trim().slice(0, 100);
    return write((run) => {
      if (data.transferId) run("DELETE FROM transactions WHERE dompet_id = ? AND transfer_id = ?", [actor.dompet_id, transferId]);
      const insert = (accountId: string, kind: Kind, amount: number, note: string, flag: TxFlag) =>
        run(
          `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, transfer_id, paid_by, created_by, updated_by)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), actor.dompet_id, accountId, kind, amount, data.date, note.slice(0, 140), flag, transferId, actor.id, actor.id, actor.id],
        );
      insert(from.id, "expense", data.amount, `Transfer ke ${to.name}${extra ? " · " + extra : ""}`, "transfer");
      insert(to.id, "income", toAmount, `Transfer dari ${from.name}${extra ? " · " + extra : ""}`, "transfer");
      if (data.fee > 0) insert(from.id, "expense", data.fee, `Biaya transfer ke ${to.name}`, null);
      if (from.visibility === "shared" && to.visibility === "shared")
        log(run, actor, `${data.transferId ? "mengubah transfer" : "mentransfer"} ${formatMoney(data.amount, from.currency)}${sameCurrency ? "" : ` (${formatMoney(toAmount, to.currency)})`} dari ${from.name} ke ${to.name}`);
      return transferId;
    });
  },

  deleteTransfer(actorId: string, transferId: string) {
    const actor = actorOf(actorId);
    const existing = q.transfer(actor.dompet_id, transferId);
    if (!existing) return Promise.resolve();
    const visible = q.accounts(actor.dompet_id, actor.id);
    const holder = (id: string) => visible.find((a) => a.id === id)?.holder_member_id === actor.id;
    if (!can.editTransaction(actor.role, existing.createdBy === actor.id, holder(existing.fromAccountId) || holder(existing.toAccountId)))
      throw new PermissionError("Anggota hanya bisa menghapus transfer sendiri.");
    return write((run) => run("DELETE FROM transactions WHERE dompet_id = ? AND transfer_id = ?", [actor.dompet_id, transferId]));
  },

  deleteTransaction(actorId: string, txId: string) {
    const actor = actorOf(actorId);
    const tx = get<{ created_by: string | null; amount: number; visibility: string; holder: string | null; currency: string }>(
      "SELECT t.created_by, t.amount, a.visibility, a.currency, COALESCE(a.holder_member_id, a.owner_member_id) AS holder FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.dompet_id = ?",
      [txId, actor.dompet_id],
    );
    if (!tx) return Promise.resolve();
    if (!can.editTransaction(actor.role, tx.created_by === actor.id, tx.holder === actor.id)) throw new PermissionError("Anggota hanya bisa menghapus catatan sendiri.");
    return write((run) => {
      run("DELETE FROM transactions WHERE id = ?", [txId]);
      if (tx.visibility === "shared") log(run, actor, `menghapus transaksi ${formatMoney(tx.amount, tx.currency)}`);
    });
  },

  // --- budgets -------------------------------------------------------------
  saveBudget(actorId: string, data: { id?: string; name: string; amount: number; category_id: string | null; member_id: string | null; category_ids?: string[]; exclude_category_ids?: string[]; period?: BudgetPeriod }) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengatur anggaran.");
    const period: BudgetPeriod = data.period ?? "monthly";
    const per = period === "daily" ? "hari" : period === "weekly" ? "minggu" : "bulan";
    if (!Number.isInteger(data.amount) || data.amount <= 0) throw new Error("Jumlah harus lebih dari 0.");
    const name = requireText(data.name, "Nama anggaran");
    // One category -> category_id (what older versions understand); several -> category_ids.
    const cats = [...new Set([...(data.category_ids ?? []), ...(data.category_id ? [data.category_id] : [])])];
    const categoryId = cats.length === 1 ? cats[0] : null;
    const categoryIds = cats.length > 1 ? JSON.stringify(cats) : null;
    const excludes = cats.length === 0 && data.exclude_category_ids?.length ? JSON.stringify(data.exclude_category_ids) : null;
    return write((run) => {
      if (data.id) {
        run("UPDATE budgets SET name = ?, amount = ?, category_id = ?, category_ids = ?, member_id = ?, exclude_category_ids = ?, period = ? WHERE id = ? AND dompet_id = ?", [
          name, data.amount, categoryId, categoryIds, data.member_id, excludes, period, data.id, actor.dompet_id,
        ]);
        log(run, actor, `mengubah anggaran ${name} menjadi ${formatIDR(data.amount)}/${per}`);
      } else {
        run("INSERT INTO budgets (id, dompet_id, name, amount, category_id, category_ids, member_id, exclude_category_ids, period, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          uid(), actor.dompet_id, name, data.amount, categoryId, categoryIds, data.member_id, excludes, period, actor.id,
        ]);
        log(run, actor, `membuat anggaran ${name} ${formatIDR(data.amount)}/${per}`);
      }
    });
  },

  deleteBudget(actorId: string, budgetId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    return write((run) => run("DELETE FROM budgets WHERE id = ? AND dompet_id = ?", [budgetId, actor.dompet_id]));
  },
};
