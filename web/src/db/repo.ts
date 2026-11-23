// Typed queries and permission-checked mutations over the SQLite database.

import { all, get, write } from "./database";
import { putInTrash, snapshot } from "./trash";
import { can, PermissionError, type Role } from "../lib/permissions";
import { currentMonth, formatIDR, parseAmount, periodDay, periodKeyFromStart, periodRange, periodStartSql, toISODate, todayISO } from "../lib/format";
import { baseSql, CURRENCIES, formatMoney, holdingsSql, isBase, rateSql, toBase } from "../lib/currency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Dompet {
  id: string;
  name: string;
  currency: string;
  /** Budget month starts on this day (payday), 1-28. */
  period_start_day: number;
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
  /** Rupiah per 1 unit of `currency` in use (live rate when fx_auto; 1 for IDR). */
  fx_rate: number;
  /** The rate stored on the account (manual rate / offline fallback). */
  fx_rate_saved: number;
  /** 1 = follow the live rate. */
  fx_auto: number;
  /** Multi-currency pocket: the main account this currency belongs to. */
  parent_id: string | null;
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
  /** Market value of stocks held here (rupiah). */
  holdings_value: number;
  /** Balance converted to rupiah plus stocks, for totals. */
  balance_base: number;
  /** Net of entries dated after today (account currency); not in `balance` yet. */
  scheduled: number;
}

export type Market = "IDX" | "US" | "CRYPTO" | "GOLD";

export interface Holding {
  id: string;
  dompet_id: string;
  account_id: string;
  market: Market;
  symbol: string;
  name: string | null;
  shares: number;
  /** Per unit, in the market's currency (USD for US, else rupiah). */
  avg_price: number;
  /** Live price per unit (same currency); null = not fetched yet. */
  price: number | null;
  change_pct: number | null;
  price_at: string | null;
}

/** 1 lot on IDX = 100 shares. */
export const LOT = 100;

/** What the units of a market are called, and its price currency. */
export const MARKETS: Record<Market, { label: string; unit: string; currency: "IDR" | "USD"; decimals: number }> = {
  IDX: { label: "Saham BEI", unit: "lot", currency: "IDR", decimals: 0 },
  US: { label: "Saham & ETF AS", unit: "lembar", currency: "USD", decimals: 4 },
  CRYPTO: { label: "Kripto", unit: "koin", currency: "IDR", decimals: 8 },
  GOLD: { label: "Emas", unit: "gram", currency: "IDR", decimals: 3 },
};
const holdingsValueOrder = `h.shares * COALESCE(mp.price, h.avg_price) * (CASE WHEN h.market = 'US' THEN COALESCE((SELECT x.price FROM market_prices x WHERE x.symbol = 'FX:USD'), 1) ELSE 1 END) DESC`;

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

/**
 * An 'adjustment' that moved cash into or out of investments rather than
 * correcting a balance: a buy/sell ("Beli BBCA 2 lot @ …") or a cash
 * balance moved into holdings ("Pindah ke investasi").
 */
export const isInvestmentMove = (note: string | null | undefined) => /^(Beli|Jual) \S+ .+ @ |^Pindah (ke|dari) investasi/.test(note ?? "");

/** One member's share of a split expense, in the account's minor units. */
export interface SplitShare {
  m: string;
  a: number;
}

export function parseSplit(json: string | null | undefined): SplitShare[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as SplitShare[];
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

/** Equal shares that add up exactly (the first ones get the leftover units). */
export function splitEqually(amount: number, memberIds: string[]): SplitShare[] {
  const n = memberIds.length;
  if (n === 0 || amount <= 0) return [];
  const base = Math.floor(amount / n);
  const rest = amount - base * n;
  return memberIds.map((m, i) => ({ m, a: base + (i < rest ? 1 : 0) }));
}

/** Fewest payments that settle everyone (greedy: biggest debtor pays biggest creditor). */
export function settleUp(nets: { id: string; net: number }[]): { from: string; to: string; amount: number }[] {
  const creditors = nets.filter((n) => n.net > 0).map((n) => ({ ...n })).sort((a, b) => b.net - a.net);
  const debtors = nets.filter((n) => n.net < 0).map((n) => ({ ...n, net: -n.net })).sort((a, b) => b.net - a.net);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    if (pay > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].net -= pay;
    creditors[j].net -= pay;
    if (debtors[i].net <= 0) i++;
    if (creditors[j].net <= 0) j++;
  }
  return out;
}

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
  /** JSON SplitShare[] when the expense is shared between members. */
  split_with: string | null;
  need: "need" | "want" | null;
  merchant: string | null;
  /** Receipt photo: data: URL (demo) or storage path (cloud). */
  receipt: string | null;
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

/**
 * Does a budget count an expense in this category (with its parent) paid by
 * this member? Mirrors the SQL filter in q.budgets.
 */
export function budgetCovers(
  b: Pick<Budget, "category_id" | "category_ids" | "exclude_category_ids" | "member_id">,
  categoryId: string | null,
  parentId: string | null,
  paidBy: string | null,
) {
  const ids = b.category_ids ? (JSON.parse(b.category_ids) as string[]) : [];
  const excl = b.exclude_category_ids ? (JSON.parse(b.exclude_category_ids) as string[]) : [];
  const hit = (list: string[]) => (categoryId !== null && list.includes(categoryId)) || (parentId !== null && list.includes(parentId));
  const inScope = (!b.category_id && ids.length === 0) || (b.category_id !== null && (categoryId === b.category_id || parentId === b.category_id)) || hit(ids);
  return inScope && !hit(excl) && (!b.member_id || paidBy === b.member_id);
}

export interface Goal {
  id: string;
  dompet_id: string;
  name: string;
  icon: string;
  /** Rupiah. */
  target: number;
  target_date: string | null;
  account_id: string | null;
  /** Manual savings in rupiah (used when no account is linked). */
  saved: number;
  created_by: string | null;
  account_name: string | null;
  account_visibility: "shared" | "private" | null;
  /** Saved so far: linked account balance (rupiah) or `saved`. */
  progress: number;
}

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

/** Named SQL params $mFrom/$mTo for a budget month (period). */
const monthParams = (month: string | null | undefined) => {
  const r = month ? periodRange(month) : null;
  return { $mFrom: r?.from ?? null, $mTo: r?.to ?? null };
};

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
      `SELECT a.*, a.fx_rate AS fx_rate_saved, ${rateSql("a")} AS fx_rate, ${holdingsSql("a")} AS holdings_value,
         h.name AS holder_name, h.emoji AS holder_emoji, h.colour AS holder_colour,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
           FROM transactions t WHERE t.account_id = a.id AND t.date <= $today), 0) AS balance,
         COALESCE((
           SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
           FROM transactions t WHERE t.account_id = a.id AND t.date > $today), 0) AS scheduled
       FROM accounts a
       LEFT JOIN members h ON h.id = COALESCE(a.holder_member_id, a.owner_member_id)
       WHERE a.dompet_id = $d AND a.archived = 0 AND ${VISIBLE_ACCOUNT}
       ORDER BY a.visibility = 'private', a.created_at`,
      // Entries dated after today don't move the balance until their day comes.
      { $d: dompetId, $me: me, $today: todayISO() },
    ).map((a): Account => ({
      ...a,
      currency: a.currency || "IDR",
      fx_rate: a.fx_rate ?? 1,
      fx_auto: a.fx_auto ?? 1,
      parent_id: a.parent_id ?? null,
      holdings_value: a.holdings_value ?? 0,
      balance_base: toBase(a.balance, a.currency, a.fx_rate) + (a.holdings_value ?? 0),
    })),

  /** Stocks held in the accounts you can see. */
  holdings: (dompetId: string, me: string, accountId?: string) =>
    all<Holding>(
      `SELECT h.*, COALESCE(h.market, 'IDX') AS market, mp.price AS price, mp.change_pct AS change_pct, mp.fetched_at AS price_at, COALESCE(h.name, mp.name) AS name
       FROM holdings h JOIN accounts a ON a.id = h.account_id
       LEFT JOIN market_prices mp ON mp.symbol = COALESCE(h.market, 'IDX') || ':' || h.symbol
       WHERE h.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ($acc IS NULL OR h.account_id = $acc)
       ORDER BY ${holdingsValueOrder}`,
      { $d: dompetId, $me: me, $acc: accountId ?? null },
    ),

  /** How many transactions use each account / category (for "most used first" pickers). */
  usage(dompetId: string) {
    const counts = new Map<string, number>();
    for (const r of all<{ id: string; n: number }>(
      `SELECT account_id AS id, COUNT(*) AS n FROM transactions WHERE dompet_id = $d GROUP BY account_id
       UNION ALL
       SELECT category_id AS id, COUNT(*) AS n FROM transactions WHERE dompet_id = $d AND category_id IS NOT NULL GROUP BY category_id`,
      { $d: dompetId },
    ))
      counts.set(r.id, (counts.get(r.id) ?? 0) + r.n);
    return counts;
  },

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
      /** Inclusive date range; used instead of `month` when set. */
      range?: { from: string; to: string };
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
          lower(t.note) LIKE $t${i} OR lower(COALESCE(t.merchant, '')) LIKE $t${i} OR lower(COALESCE(c.name, '')) LIKE $t${i} OR lower(COALESCE(pc.name, '')) LIKE $t${i}
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
         AND ($mFrom IS NULL OR t.date BETWEEN $mFrom AND $mTo)
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
        ...(f.range ? { $mFrom: f.range.from, $mTo: f.range.to } : monthParams(f.month)),
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
      merchant: string | null;
      need: "need" | "want" | null;
    }>(
      `SELECT t.note, t.kind, t.amount, t.category_id, t.account_id, t.paid_by, t.date, t.merchant, t.need,
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

  /**
   * Entries dated after today up to `to` (inclusive), in rupiah, already
   * recorded but not in balances yet. sharedOnly: shared accounts only, and
   * transfers between them cancel out.
   */
  scheduledEntries(dompetId: string, me: string, to: string, sharedOnly = false) {
    return all<{ id: string; date: string; note: string; kind: Kind; flag: TxFlag; amount_base: number; category_name: string | null; category_icon: string | null }>(
      `SELECT t.id, t.date, t.note, t.kind, t.flag, ${BASE_AMOUNT} AS amount_base, c.name AS category_name, c.icon AS category_icon
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND t.date > $today AND t.date <= $to
         AND ($shared = 0 OR a.visibility = 'shared')
       ORDER BY t.date, t.created_at`,
      { $d: dompetId, $me: me, $today: todayISO(), $to: to, $shared: sharedOnly ? 1 : 0 },
    );
  },

  /** Shop names used before (most used first), for the "Tempat beli" suggestions. */
  merchants(dompetId: string) {
    return all<{ merchant: string }>(
      `SELECT merchant FROM transactions WHERE dompet_id = ? AND merchant IS NOT NULL AND merchant <> ''
       GROUP BY lower(merchant) ORDER BY count(*) DESC, max(date) DESC LIMIT 30`,
      [dompetId],
    ).map((r) => r.merchant);
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

  /** Date of the earliest visible transaction (YYYY-MM-DD), or null. */
  firstTxDate: (dompetId: string, me: string) =>
    get<{ d: string | null }>(
      `SELECT MIN(t.date) AS d FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT}`,
      { $d: dompetId, $me: me },
    )?.d ?? null,

  monthTotals(dompetId: string, me: string, month: string) {
    return (
      get<{ income: number; expense: number }>(
        `SELECT COALESCE(SUM(CASE WHEN t.kind='income' THEN ${BASE_AMOUNT} END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind='expense' THEN ${BASE_AMOUNT} END), 0) AS expense
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND t.date BETWEEN $mFrom AND $mTo`,
        { $d: dompetId, $me: me, ...monthParams(month) },
      ) ?? { income: 0, expense: 0 }
    );
  },

  /** Spending this month split by the kebutuhan / keinginan tag (untagged separate). */
  needWant(dompetId: string, me: string, month: string) {
    return (
      get<{ need: number; want: number; untagged: number }>(
        `SELECT COALESCE(SUM(CASE WHEN t.need = 'need' THEN ${BASE_AMOUNT} END), 0) AS need,
                COALESCE(SUM(CASE WHEN t.need = 'want' THEN ${BASE_AMOUNT} END), 0) AS want,
                COALESCE(SUM(CASE WHEN t.need IS NULL THEN ${BASE_AMOUNT} END), 0) AS untagged
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND t.kind = 'expense' AND t.date BETWEEN $mFrom AND $mTo`,
        { $d: dompetId, $me: me, ...monthParams(month) },
      ) ?? { need: 0, want: 0, untagged: 0 }
    );
  },

  spendingByMember(dompetId: string, me: string, month: string) {
    return all<{ id: string; name: string; emoji: string; colour: string; total: number }>(
      `SELECT m.id, m.name, m.emoji, m.colour,
              COALESCE(SUM(${BASE_AMOUNT}), 0) AS total
       FROM members m
       LEFT JOIN (transactions t JOIN accounts a ON a.id = t.account_id AND a.dompet_id = $d AND ${VISIBLE_ACCOUNT})
         ON t.paid_by = m.id AND t.kind = 'expense' AND ${REAL}
         AND t.date BETWEEN $mFrom AND $mTo
       WHERE m.dompet_id = $d
       GROUP BY m.id ORDER BY total DESC`,
      { $d: dompetId, $me: me, ...monthParams(month) },
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
         AND t.date BETWEEN $mFrom AND $mTo
       GROUP BY top.id ORDER BY total DESC`,
      { $d: dompetId, $me: me, ...monthParams(month) },
    );
  },

  /** Budgets count shared-account spending only, so every member sees the same progress. */
  /**
   * Budgets with progress for the period that matters when viewing `month`:
   * in the current month a daily budget tracks today and a weekly one this
   * week (Mon-Sun); for past months they show the whole month against the
   * equivalent limit (amount x days/7 or x days).
   */
  budgets(
    dompetId: string,
    month: string,
    opts: { wholeMonth?: boolean; range?: { from: string; to: string }; excludeRecurring?: boolean } = {},
  ) {
    // wholeMonth: month-to-date spending against the monthly-equivalent limit,
    // for every period (used by forecasts). range: spending between two dates
    // instead; excludeRecurring leaves out entries recorded from Rutin items.
    const isCurrent = month === currentMonth() && !opts.wholeMonth;
    const { from: monthFrom, to: monthTo, days: daysInMonth } = periodRange(month);
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
                  AND ($noRec = 0 OR t.recurring_id IS NULL)
                  AND t.date BETWEEN
                        (CASE WHEN $rangeFrom IS NOT NULL THEN $rangeFrom
                              WHEN $current = 1 AND b.period = 'weekly' THEN $weekFrom
                              WHEN $current = 1 AND b.period = 'daily' THEN $today
                              ELSE $monthFrom END)
                    AND (CASE WHEN $rangeTo IS NOT NULL THEN $rangeTo
                              WHEN $current = 1 AND b.period = 'weekly' THEN $weekTo
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
      { $d: dompetId, $current: isCurrent ? 1 : 0, $weekFrom: weekFrom, $weekTo: weekTo, $today: today, $monthFrom: monthFrom, $monthTo: monthTo,
        $rangeFrom: opts.range?.from ?? null, $rangeTo: opts.range?.to ?? null, $noRec: opts.excludeRecurring ? 1 : 0 },
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
      `SELECT ${periodStartSql("t.date")} AS month,
              COALESCE(SUM(CASE WHEN t.kind='income' THEN ${BASE_AMOUNT} END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind='expense' THEN ${BASE_AMOUNT} END), 0) AS expense
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL}
         AND t.date BETWEEN $from AND $to
       GROUP BY month`,
      { $d: dompetId, $me: me, $from: periodRange(months[0]).from, $to: periodRange(months[months.length - 1]).to },
    );
    const byMonth = new Map(rows.map((r) => [periodKeyFromStart(r.month), { ...r, month: periodKeyFromStart(r.month) }]));
    return months.map((m) => byMonth.get(m) ?? { month: m, income: 0, expense: 0 });
  },

  /** Expense per day of a budget month: [{ day: 1..length, total }] (day 1 = first day of the period). */
  dailyExpense(dompetId: string, me: string, month: string) {
    return all<{ day: number; total: number }>(
      `SELECT CAST(julianday(t.date) - julianday($mFrom) AS INTEGER) + 1 AS day, SUM(${BASE_AMOUNT}) AS total
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND t.kind = 'expense'
         AND t.date BETWEEN $mFrom AND $mTo
       GROUP BY day ORDER BY day`,
      { $d: dompetId, $me: me, ...monthParams(month) },
    );
  },

  /** Net balance change (all flows, incl. transfers) per month from `from` onward. */
  netChangeSince(dompetId: string, me: string, from: string) {
    return all<{ month: string; net: number }>(
      `SELECT ${periodStartSql("t.date")} AS month,
              SUM(CASE t.kind WHEN 'income' THEN ${BASE_AMOUNT} ELSE -${BASE_AMOUNT} END) AS net
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND t.date >= $from
       GROUP BY month`,
      { $d: dompetId, $me: me, $from: periodRange(from).from },
    ).map((r) => ({ ...r, month: periodKeyFromStart(r.month) }));
  },

  /**
   * Shared-account expense per day of `month` that at least one budget covers
   * (each expense counted once). Used when there is no overall budget.
   */
  budgetCoveredDaily(dompetId: string, me: string, month: string) {
    const budgets = q.budgets(dompetId, month, { wholeMonth: true });
    const parentOf = new Map(q.categories(dompetId).map((c) => [c.id, c.parent_id]));
    const byDay = new Map<number, number>();
    for (const t of q.transactions(dompetId, me, { month, kind: "expense" })) {
      if (t.flag || t.account_visibility !== "shared") continue;
      const parent = t.category_id ? (parentOf.get(t.category_id) ?? null) : null;
      if (!budgets.some((b) => budgetCovers(b, t.category_id, parent, t.paid_by))) continue;
      const day = periodDay(t.date, month);
      byDay.set(day, (byDay.get(day) ?? 0) + t.amount_base);
    }
    return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, total]) => ({ day, total }));
  },

  /**
   * The monthly spending limit to compare against: a budget for all spending
   * ("Total bulanan", daily/weekly ones scaled to the month), or else every
   * budget combined. `combined` = how many budgets were added up (0 = one
   * overall budget). null when there are no budgets.
   */
  overallBudget(dompetId: string, me: string, month: string) {
    const all = q.budgets(dompetId, month, { wholeMonth: true });
    if (all.length === 0) return null;
    const family = all.filter((b) => !b.category_id && !b.category_ids && !b.member_id);
    const pick = family.find((b) => b.period === "monthly") ?? family[0];
    if (pick) return { amount: pick.limit, spent: pick.spent, combined: 0, name: pick.name };
    const spent = q.budgetCoveredDaily(dompetId, me, month).reduce((s, d) => s + d.total, 0);
    return { amount: all.reduce((s, b) => s + b.limit, 0), spent, combined: all.length, name: `Gabungan ${all.length} anggaran` };
  },

  /**
   * Patungan balances in rupiah: paid = what each member paid for split
   * expenses (and settlements), owed = their shares. net > 0: others owe them.
   * Only shared accounts count, so everyone sees the same numbers.
   */
  splitBalances(dompetId: string) {
    const rows = all<{ id: string; flag: TxFlag; paid_by: string | null; split_with: string; amount: number; amount_base: number }>(
      `SELECT t.id, t.flag, t.paid_by, t.split_with, t.amount, ${BASE_AMOUNT} AS amount_base
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND t.split_with IS NOT NULL AND t.kind = 'expense' AND a.visibility = 'shared'`,
      { $d: dompetId },
    );
    // Shared expenses (paid / share) and settlements (sent / received) kept apart for display.
    const sum = { paid: new Map<string, number>(), owed: new Map<string, number>(), sent: new Map<string, number>(), received: new Map<string, number>() };
    const add = (mp: Map<string, number>, k: string, v: number) => mp.set(k, (mp.get(k) ?? 0) + v);
    for (const r of rows) {
      const shares = parseSplit(r.split_with);
      if (!shares || !r.paid_by || r.amount <= 0) continue;
      const rate = r.amount_base / r.amount;
      const settle = r.flag === "transfer";
      add(settle ? sum.sent : sum.paid, r.paid_by, r.amount_base);
      for (const x of shares) add(settle ? sum.received : sum.owed, x.m, x.a * rate);
    }
    const v = (mp: Map<string, number>, k: string) => Math.round(mp.get(k) ?? 0);
    return q.members(dompetId).map((m) => {
      const paid = v(sum.paid, m.id);
      const owed = v(sum.owed, m.id);
      const sent = v(sum.sent, m.id);
      const received = v(sum.received, m.id);
      return { id: m.id, name: m.name, emoji: m.emoji, colour: m.colour, paid, owed, sent, received, net: paid - owed + sent - received };
    });
  },

  /** Savings goals you can see (one linked to someone's private account is theirs only). */
  goals(dompetId: string, me: string): Goal[] {
    const balances = new Map(q.accounts(dompetId, me).map((a) => [a.id, a.balance_base]));
    return all<Omit<Goal, "progress">>(
      `SELECT g.*, a.name AS account_name, a.visibility AS account_visibility
       FROM goals g LEFT JOIN accounts a ON a.id = g.account_id
       WHERE g.dompet_id = $d AND (g.account_id IS NULL OR ${VISIBLE_ACCOUNT})
       ORDER BY COALESCE(g.target_date, '9999'), g.created_at`,
      { $d: dompetId, $me: me },
    ).map((g) => ({ ...g, progress: g.account_id ? Math.max(0, balances.get(g.account_id) ?? 0) : g.saved }));
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

type AccountRow = {
  id: string; name: string; type: string; currency: string; colour: string; icon: string | null; visibility: "shared" | "private";
  owner_member_id: string | null; holder_member_id: string | null; parent_id: string | null;
};

/** An account the actor can see (shared, or their own private one). */
function visibleAccount(actor: Member, accountId: string): AccountRow {
  const acc = get<AccountRow>(
    "SELECT id, name, type, currency, colour, icon, visibility, owner_member_id, holder_member_id, parent_id FROM accounts WHERE id = ? AND dompet_id = ?",
    [accountId, actor.dompet_id],
  );
  if (!acc || (acc.visibility === "private" && acc.owner_member_id !== actor.id)) throw new Error("Akun tidak ditemukan.");
  return acc;
}

/** An account the actor may change (admin, its holder, or its private owner). */
function editableAccount(actor: Member, accountId: string): AccountRow {
  const acc = visibleAccount(actor, accountId);
  const ok = can.manage(actor.role) || (acc.visibility === "private" && acc.owner_member_id === actor.id) || (acc.visibility === "shared" && acc.holder_member_id === actor.id);
  if (!ok) throw new PermissionError();
  return acc;
}

function cleanSymbol(symbol: string, market: Market = "IDX") {
  if (market === "GOLD") return "EMAS";
  const s = symbol.trim().toUpperCase().replace(/\.JK$/, "");
  const ok = market === "IDX" ? /^[A-Z0-9]{2,6}$/ : market === "US" ? /^[A-Z0-9.-]{1,10}$/ : /^[A-Z0-9]{2,10}$/;
  if (!ok.test(s)) throw new Error(market === "IDX" ? "Kode saham tidak valid (mis. BBCA)." : market === "US" ? "Kode tidak valid (mis. AAPL, VOO)." : "Kode koin tidak valid (mis. BTC).");
  return s;
}

/** "2 lot", "0,0125 koin", "2,5 gram", "1,5 lembar". */
export function unitsText(market: Market, shares: number) {
  const m = MARKETS[market];
  const n = market === "IDX" ? shares / LOT : shares;
  return `${n.toLocaleString("id-ID", { maximumFractionDigits: m.decimals })} ${m.unit}`;
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

  /** Budget month starts on payday (1-28) instead of the 1st. */
  setPeriodStartDay(actorId: string, day: number) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengubah awal bulan.");
    if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error("Pilih tanggal 1 sampai 28.");
    return write((run) => {
      run("UPDATE dompets SET period_start_day = ? WHERE id = ?", [day, actor.dompet_id]);
      log(run, actor, day === 1 ? "mengembalikan awal bulan anggaran ke tanggal 1" : `mengubah awal bulan anggaran ke tanggal ${day} (tanggal gajian)`);
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
      visibility: "shared" | "private"; holder_member_id?: string | null; currency?: string; fx_rate?: number; fx_auto?: boolean;
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
    const fxAuto = data.fx_auto === false ? 0 : 1;
    return write((run) => {
      if (data.id) {
        run(
          `UPDATE accounts SET name = ?, type = ?, opening_balance = ?, colour = ?, icon = ?, visibility = ?, currency = ?, fx_rate = ?, fx_auto = ?,
             owner_member_id = CASE WHEN ? = 'private' THEN COALESCE(owner_member_id, ?) ELSE NULL END
           WHERE id = ? AND dompet_id = ?`,
          [name, type, data.opening_balance, data.colour, data.icon ?? null, data.visibility, currency, fxRate, fxAuto, data.visibility, actor.id, data.id, actor.dompet_id],
        );
        // Currencies inside this pocket follow its name, group, look and visibility.
        if (!get<{ parent_id: string | null }>("SELECT parent_id FROM accounts WHERE id = ?", [data.id])?.parent_id)
          run(
            `UPDATE accounts SET name = substr(?, 1, 35) || ' ' || currency, type = ?, colour = ?, icon = ?, visibility = ?,
               owner_member_id = (SELECT owner_member_id FROM accounts p WHERE p.id = ?), holder_member_id = (SELECT holder_member_id FROM accounts p WHERE p.id = ?)
             WHERE parent_id = ? AND dompet_id = ?`,
            [name, type, data.colour, data.icon ?? null, data.visibility, data.id, data.id, data.id, actor.dompet_id],
          );
        // Holder changes on shared accounts are an admin decision.
        if (can.manage(actor.role) && data.visibility === "shared" && data.holder_member_id !== undefined) {
          run("UPDATE accounts SET holder_member_id = ? WHERE id = ? AND dompet_id = ?", [data.holder_member_id, data.id, actor.dompet_id]);
        }
        log(run, actor, `mengubah akun ${name}`);
      } else {
        run(
          `INSERT INTO accounts (id, dompet_id, name, type, opening_balance, currency, fx_rate, fx_auto, colour, icon, visibility, owner_member_id, holder_member_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uid(), actor.dompet_id, name, type, data.opening_balance, currency, fxRate, fxAuto, data.colour, data.icon ?? null, data.visibility,
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

  // --- multi-currency pockets ---------------------------------------------
  /**
   * Adds another currency to a pocket (like BCA Valas). The new currency is a
   * child account of `parentId`: same name + code, group, look and owner.
   */
  addPocketCurrency(actorId: string, parentId: string, currency: string, openingBalance: number) {
    const actor = actorOf(actorId);
    const parent = editableAccount(actor, parentId);
    if (parent.parent_id) throw new Error("Pilih akun utama dompet valas.");
    if (!CURRENCIES.some((c) => c.code === currency)) throw new Error("Mata uang tidak didukung.");
    if (!Number.isFinite(openingBalance)) throw new Error("Saldo awal tidak valid.");
    const taken = all<{ currency: string }>("SELECT currency FROM accounts WHERE id = ? OR parent_id = ?", [parentId, parentId]).map((r) => r.currency);
    if (taken.includes(currency)) throw new Error(`${currency} sudah ada di ${parent.name}.`);
    const rate = isBase(currency) ? 1 : (get<{ price: number }>("SELECT price FROM market_prices WHERE symbol = ?", [`FX:${currency}`])?.price ?? 1);
    return write((run) => {
      run(
        `INSERT INTO accounts (id, dompet_id, name, type, opening_balance, currency, fx_rate, fx_auto, colour, icon, visibility, owner_member_id, holder_member_id, parent_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [uid(), actor.dompet_id, `${parent.name.slice(0, 35)} ${currency}`, parent.type, Math.round(openingBalance), currency, rate,
          parent.colour, parent.icon, parent.visibility, parent.owner_member_id, parent.holder_member_id, parentId, actor.id],
      );
      if (parent.visibility === "shared") log(run, actor, `menambahkan ${currency} ke ${parent.name}`);
    });
  },

  // --- stocks (IDX) ----------------------------------------------------------
  /**
   * Sets a holding directly (for stocks already owned): lots and average
   * price. No cash moves. `lots` 0 removes it.
   */
  setHolding(actorId: string, data: { accountId: string; market?: Market; symbol: string; name?: string | null; shares: number; avgPrice: number }) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError();
    const acc = visibleAccount(actor, data.accountId);
    const market = data.market ?? "IDX";
    const symbol = cleanSymbol(data.symbol, market);
    if (!Number.isFinite(data.shares) || data.shares < 0 || (market === "IDX" && !Number.isInteger(data.shares))) throw new Error("Jumlah tidak valid.");
    if (!Number.isFinite(data.avgPrice) || data.avgPrice < 0) throw new Error("Harga rata-rata tidak valid.");
    const existing = get<{ id: string }>("SELECT id FROM holdings WHERE account_id = ? AND market = ? AND symbol = ?", [acc.id, market, symbol]);
    return write((run) => {
      if (data.shares === 0) {
        if (existing) run("DELETE FROM holdings WHERE id = ?", [existing.id]);
      } else if (existing) {
        run("UPDATE holdings SET shares = ?, avg_price = ?, name = COALESCE(?, name), updated_at = datetime('now') WHERE id = ?", [
          data.shares, data.avgPrice, data.name ?? null, existing.id,
        ]);
      } else {
        run("INSERT INTO holdings (id, dompet_id, account_id, market, symbol, name, shares, avg_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          uid(), actor.dompet_id, acc.id, market, symbol, data.name ?? null, data.shares, data.avgPrice, actor.id,
        ]);
      }
      if (acc.visibility === "shared")
        log(run, actor, data.shares === 0 ? `menghapus ${symbol} dari ${acc.name}` : `mengatur ${symbol} di ${acc.name}: ${unitsText(market, data.shares)}`);
    });
  },

  /**
   * Buy or sell: updates lots (and the average price on a buy) and, when
   * `moveCash`, records the money on the account's cash balance as a
   * correction (not counted as spending or income).
   */
  tradeStock(
    actorId: string,
    data: {
      accountId: string; side: "buy" | "sell"; market?: Market; symbol: string; name?: string | null;
      /** Units: lots for IDX, else shares / coins / grams. */
      lots: number; price: number; fee: number; date: string; moveCash: boolean;
    },
  ) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError();
    const acc = visibleAccount(actor, data.accountId);
    const market = data.market ?? "IDX";
    const priceCur = MARKETS[market].currency;
    if (data.moveCash && acc.currency !== priceCur) throw new Error(`Saldo kas ${acc.name} dalam ${acc.currency}, harga dalam ${priceCur}. Matikan "potong saldo kas".`);
    const symbol = cleanSymbol(data.symbol, market);
    if (!Number.isFinite(data.lots) || data.lots <= 0 || (market === "IDX" && !Number.isInteger(data.lots))) throw new Error(market === "IDX" ? "Isi jumlah lot (bilangan bulat)." : "Isi jumlahnya.");
    if (!Number.isFinite(data.price) || data.price <= 0) throw new Error("Isi harga.");
    if (!Number.isFinite(data.fee) || data.fee < 0) throw new Error("Biaya tidak valid.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Tanggal tidak valid.");
    const shares = market === "IDX" ? data.lots * LOT : data.lots;
    const existing = get<{ id: string; shares: number; avg_price: number }>("SELECT id, shares, avg_price FROM holdings WHERE account_id = ? AND market = ? AND symbol = ?", [acc.id, market, symbol]);
    if (data.side === "sell" && (!existing || existing.shares < shares - 1e-9))
      throw new Error(`${symbol} tidak cukup (punya ${unitsText(market, existing?.shares ?? 0)}).`);
    // Money in minor units of the price currency (cents for USD).
    const minor = priceCur === "USD" ? 100 : 1;
    const gross = Math.round(shares * data.price * minor);
    const fee = Math.round(data.fee * minor);
    const cash = data.side === "buy" ? gross + fee : gross - fee;
    if (cash <= 0) throw new Error("Biaya lebih besar dari nilai jual.");
    const label = `${data.side === "buy" ? "Beli" : "Jual"} ${symbol} ${unitsText(market, shares)} @ ${formatMoney(Math.round(data.price * minor * (market === "IDX" ? LOT : 1)), priceCur)}${market === "IDX" ? "/lot" : ""}`;
    return write((run) => {
      if (data.side === "buy") {
        if (existing) {
          const total = existing.shares + shares;
          const avg = (existing.shares * existing.avg_price + (gross + fee) / minor) / total;
          run("UPDATE holdings SET shares = ?, avg_price = ?, name = COALESCE(?, name), updated_at = datetime('now') WHERE id = ?", [total, avg, data.name ?? null, existing.id]);
        } else {
          run("INSERT INTO holdings (id, dompet_id, account_id, market, symbol, name, shares, avg_price, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            uid(), actor.dompet_id, acc.id, market, symbol, data.name ?? null, shares, (gross + fee) / minor / shares, actor.id,
          ]);
        }
      } else if (existing!.shares - shares < 1e-9) {
        run("DELETE FROM holdings WHERE id = ?", [existing!.id]);
      } else {
        run("UPDATE holdings SET shares = ?, updated_at = datetime('now') WHERE id = ?", [existing!.shares - shares, existing!.id]);
      }
      if (data.moveCash)
        run(
          `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, paid_by, created_by, updated_by)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'adjustment', ?, ?, ?)`,
          [uid(), actor.dompet_id, acc.id, data.side === "buy" ? "expense" : "income", cash, data.date, label, actor.id, actor.id, actor.id],
        );
      if (acc.visibility === "shared") log(run, actor, `${label} di ${acc.name}`);
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

  /**
   * Merge `sourceId` into `targetId`: its transactions, recurring items and
   * budgets move to the target, then the source is removed. Subcategories of
   * the source move under the target (or are merged into it too when the
   * target is itself a subcategory, since there is only one level).
   */
  mergeCategory(actorId: string, sourceId: string, targetId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa menggabungkan kategori.");
    type Row = { id: string; name: string; kind: Kind; parent_id: string | null; dompet_id: string };
    const src = get<Row>("SELECT id, name, kind, parent_id, dompet_id FROM categories WHERE id = ?", [sourceId]);
    const dst = get<Row>("SELECT id, name, kind, parent_id, dompet_id FROM categories WHERE id = ?", [targetId]);
    if (!src || !dst || src.dompet_id !== actor.dompet_id || dst.dompet_id !== actor.dompet_id) throw new Error("Kategori tidak ditemukan.");
    if (src.id === dst.id) throw new Error("Pilih kategori lain sebagai tujuan.");
    if (src.kind !== dst.kind) throw new Error("Hanya bisa digabung dengan kategori sejenis (pengeluaran/pemasukan).");
    if (dst.parent_id === src.id) throw new Error("Tidak bisa digabung ke subkategorinya sendiri.");
    const subs = all<{ id: string }>("SELECT id FROM categories WHERE parent_id = ?", [src.id]).map((r) => r.id);
    // Categories that disappear: the source, plus its subs when they cannot move under the target.
    const gone = dst.parent_id ? [src.id, ...subs] : [src.id];
    const marks = gone.map(() => "?").join(",");
    const remap = (json: string | null) => {
      if (!json) return json;
      try {
        const ids = (JSON.parse(json) as string[]).map((id) => (gone.includes(id) ? dst.id : id));
        return JSON.stringify([...new Set(ids)]);
      } catch {
        return json;
      }
    };
    const budgets = all<{ id: string; category_ids: string | null; exclude_category_ids: string | null }>(
      "SELECT id, category_ids, exclude_category_ids FROM budgets WHERE dompet_id = ? AND (category_ids IS NOT NULL OR exclude_category_ids IS NOT NULL)",
      [actor.dompet_id],
    );
    return write((run) => {
      if (!dst.parent_id) run("UPDATE categories SET parent_id = ? WHERE parent_id = ?", [dst.id, src.id]);
      run(`UPDATE transactions SET category_id = ?, updated_by = ?, updated_at = datetime('now') WHERE dompet_id = ? AND category_id IN (${marks})`, [dst.id, actor.id, actor.dompet_id, ...gone]);
      run(`UPDATE recurring SET category_id = ? WHERE dompet_id = ? AND category_id IN (${marks})`, [dst.id, actor.dompet_id, ...gone]);
      run(`UPDATE budgets SET category_id = ? WHERE dompet_id = ? AND category_id IN (${marks})`, [dst.id, actor.dompet_id, ...gone]);
      for (const b of budgets) {
        const ci = remap(b.category_ids);
        const ex = remap(b.exclude_category_ids);
        if (ci !== b.category_ids || ex !== b.exclude_category_ids) run("UPDATE budgets SET category_ids = ?, exclude_category_ids = ? WHERE id = ?", [ci, ex, b.id]);
      }
      run(`DELETE FROM categories WHERE dompet_id = ? AND id IN (${marks})`, [actor.dompet_id, ...gone]);
      log(run, actor, `menggabungkan kategori ${src.name} ke ${dst.name}`);
    });
  },

  deleteCategory(actorId: string, categoryId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    return write((run) => run("DELETE FROM categories WHERE id = ? AND dompet_id = ?", [categoryId, actor.dompet_id]));
  },

  // --- transactions --------------------------------------------------------
  /** Many new entries at once (Catat banyak sekaligus): all saved or none. */
  saveBulk(
    actorId: string,
    rows: { kind: Kind; amount: number; account_id: string; category_id: string | null; date: string; note: string; paid_by: string }[],
  ) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa mencatat transaksi.");
    if (rows.length === 0) throw new Error("Belum ada baris yang diisi.");
    if (rows.length > 200) throw new Error("Maksimal 200 baris sekali simpan.");
    const accounts = new Map(q.accounts(actor.dompet_id, actor.id).map((a) => [a.id, a]));
    const memberIds = new Set(q.members(actor.dompet_id).map((x) => x.id));
    const catIds = new Set(q.categories(actor.dompet_id).map((c) => c.id));
    rows.forEach((r, i) => {
      const n = `Baris ${i + 1}: `;
      if (!Number.isInteger(r.amount) || r.amount <= 0) throw new Error(n + "jumlah harus lebih dari 0.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error(n + "tanggal tidak valid.");
      const acc = accounts.get(r.account_id);
      if (!acc) throw new Error(n + "pilih akun.");
      if (acc.visibility === "private" && acc.owner_member_id !== actor.id) throw new PermissionError(n + "itu akun pribadi orang lain.");
      if (!memberIds.has(r.paid_by)) throw new Error(n + "pilih siapa yang bayar.");
      if (r.category_id && !catIds.has(r.category_id)) throw new Error(n + "kategori tidak ditemukan.");
    });
    const shared = rows.filter((r) => accounts.get(r.account_id)?.visibility === "shared");
    const out = shared.filter((r) => r.kind === "expense").reduce((t, r) => t + toBase(r.amount, accounts.get(r.account_id)!.currency, accounts.get(r.account_id)!.fx_rate), 0);
    const inn = shared.filter((r) => r.kind === "income").reduce((t, r) => t + toBase(r.amount, accounts.get(r.account_id)!.currency, accounts.get(r.account_id)!.fx_rate), 0);
    return write((run) => {
      for (const r of rows)
        run(
          `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), actor.dompet_id, r.account_id, r.category_id, r.kind, r.amount, r.date, r.note.trim().slice(0, 140), r.paid_by, actor.id, actor.id],
        );
      if (shared.length)
        log(run, actor, `mencatat ${shared.length} transaksi sekaligus${out ? ` (keluar ${formatIDR(out)}` : ""}${out && inn ? ", " : out ? ")" : " ("}${inn ? `masuk ${formatIDR(inn)})` : ""}`);
      return rows.length;
    });
  },

  saveTransaction(
    actorId: string,
    data: {
      id?: string; kind: Kind; amount: number; account_id: string; category_id: string | null; date: string; note: string; paid_by: string;
      /** Who the expense is for (shares add up to `amount`); null = not split. */
      split?: SplitShare[] | null;
      need?: "need" | "want" | null;
      merchant?: string;
      receipt?: string | null;
      /** New entries only: one transaction per line (different categories), same everything else. */
      lines?: { category_id: string | null; amount: number }[];
    },
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
    const split = data.split?.length ? data.split : null;
    if (split) {
      if (data.kind !== "expense") throw new Error("Hanya pengeluaran yang bisa dibagi.");
      if (acc.visibility !== "shared") throw new Error("Akun pribadi tidak bisa dipakai untuk patungan.");
      const memberIds = new Set(q.members(actor.dompet_id).map((x) => x.id));
      if (new Set(split.map((x) => x.m)).size !== split.length || split.some((x) => !memberIds.has(x.m)))
        throw new Error("Pilih anggota untuk dibagi.");
      if (split.some((x) => !Number.isInteger(x.a) || x.a <= 0)) throw new Error("Setiap bagian harus lebih dari 0.");
      const sum = split.reduce((t, x) => t + x.a, 0);
      if (sum !== data.amount) throw new Error(`Total bagian ${formatMoney(sum, acc.currency)} belum sama dengan ${formatMoney(data.amount, acc.currency)}.`);
    }
    const splitJson = split ? JSON.stringify(split) : null;
    const need = data.need === "need" || data.need === "want" ? data.need : null;
    const merchant = data.merchant?.trim().slice(0, 60) || null;
    const receipt = data.receipt || null;
    const lines = !data.id && data.lines && data.lines.length > 1 ? data.lines : null;
    if (lines) {
      if (split) throw new Error("Patungan belum bisa digabung dengan pecah kategori.");
      if (lines.some((l) => !Number.isInteger(l.amount) || l.amount <= 0)) throw new Error("Isi jumlah di setiap baris.");
    }

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
    const what = `${data.kind === "expense" ? "pengeluaran" : "pemasukan"} ${formatMoney(data.amount, acc.currency)}${cat ? ` · ${cat.icon} ${cat.name}` : ""}${payer && payer.id !== actor.id ? ` (dibayar ${payer.name})` : ""}${split ? `, dibagi ${split.length} orang` : ""}`;

    return write((run) => {
      if (data.id) {
        run(
          `UPDATE transactions SET kind = ?, amount = ?, account_id = ?, category_id = ?, date = ?, note = ?,
             paid_by = ?, split_with = ?, need = ?, merchant = ?, receipt = ?, updated_by = ?, updated_at = datetime('now')
           WHERE id = ? AND dompet_id = ?`,
          [data.kind, data.amount, data.account_id, data.category_id, data.date, note, data.paid_by, splitJson, need, merchant, receipt, actor.id, data.id, actor.dompet_id],
        );
        if (acc.visibility === "shared") log(run, actor, `mengubah ${what}`);
      } else {
        for (const line of lines ?? [{ category_id: data.category_id, amount: data.amount }])
          run(
            `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, split_with, need, merchant, receipt, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid(), actor.dompet_id, data.account_id, line.category_id, data.kind, line.amount, data.date, note, data.paid_by, splitJson, need, merchant, receipt, actor.id, actor.id],
          );
        if (acc.visibility === "shared") log(run, actor, lines ? `mencatat ${data.kind === "expense" ? "pengeluaran" : "pemasukan"} ${formatMoney(lines.reduce((t, l) => t + l.amount, 0), acc.currency)} dipecah ke ${lines.length} kategori` : `mencatat ${what}`);
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
      /** Settling a patungan debt: debtor pays creditor. Kept as is when editing and left out. */
      settle?: { debtor: string; creditor: string } | null;
    },
  ) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa membuat transfer.");
    if (!Number.isInteger(data.amount) || data.amount <= 0) throw new Error("Jumlah harus lebih dari 0.");
    if (!Number.isInteger(data.fee) || data.fee < 0) throw new Error("Biaya admin tidak valid.");
    // A settlement paid in cash outside the app may use one account for both sides (balance unchanged).
    if (data.fromAccountId === data.toAccountId && !data.settle) throw new Error("Pilih dua akun yang berbeda.");
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
    // Settlement: the outgoing side is paid by the debtor and fully "for" the creditor.
    let settle = data.settle;
    if (settle === undefined && data.transferId) {
      const prev = get<{ paid_by: string | null; split_with: string | null }>(
        "SELECT paid_by, split_with FROM transactions WHERE dompet_id = ? AND transfer_id = ? AND flag = 'transfer' AND kind = 'expense'",
        [actor.dompet_id, data.transferId],
      );
      const prevSplit = parseSplit(prev?.split_with);
      settle = prev?.paid_by && prevSplit?.length === 1 ? { debtor: prev.paid_by, creditor: prevSplit[0].m } : null;
    }
    if (settle) {
      const memberIds = new Set(q.members(actor.dompet_id).map((x) => x.id));
      if (!memberIds.has(settle.debtor) || !memberIds.has(settle.creditor) || settle.debtor === settle.creditor) throw new Error("Pilih siapa membayar siapa.");
      if (from.visibility !== "shared" || to.visibility !== "shared") throw new Error("Pelunasan patungan harus lewat akun bersama.");
    }
    return write((run) => {
      if (data.transferId) run("DELETE FROM transactions WHERE dompet_id = ? AND transfer_id = ?", [actor.dompet_id, transferId]);
      const insert = (accountId: string, kind: Kind, amount: number, note: string, flag: TxFlag, paidBy = actor.id, split: string | null = null) =>
        run(
          `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, transfer_id, paid_by, split_with, created_by, updated_by)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), actor.dompet_id, accountId, kind, amount, data.date, note.slice(0, 140), flag, transferId, paidBy, split, actor.id, actor.id],
        );
      const names = settle ? { d: q.member(settle.debtor)?.name ?? "", c: q.member(settle.creditor)?.name ?? "" } : null;
      insert(
        from.id, "expense", data.amount,
        settle && names ? `Lunas patungan: ${names.d} → ${names.c}${extra ? " · " + extra : ""}` : `Transfer ke ${to.name}${extra ? " · " + extra : ""}`,
        "transfer",
        settle ? settle.debtor : actor.id,
        settle ? JSON.stringify([{ m: settle.creditor, a: data.amount }]) : null,
      );
      insert(to.id, "income", toAmount, `Transfer dari ${from.name}${extra ? " · " + extra : ""}`, "transfer");
      if (data.fee > 0) insert(from.id, "expense", data.fee, `Biaya transfer ke ${to.name}`, null);
      if (settle && names) log(run, actor, `mencatat ${names.d} melunasi patungan ${formatMoney(data.amount, from.currency)} ke ${names.c}`);
      else if (from.visibility === "shared" && to.visibility === "shared")
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
    const label = `transfer ${formatMoney(existing.amount, visible.find((a) => a.id === existing.fromAccountId)?.currency)}`;
    const rows = snapshot("transactions", "dompet_id = ? AND transfer_id = ?", [actor.dompet_id, transferId]);
    return write((run) => {
      run("DELETE FROM transactions WHERE dompet_id = ? AND transfer_id = ?", [actor.dompet_id, transferId]);
      return putInTrash(run, actor.dompet_id, actor.id, label, [rows]);
    });
  },

  /**
   * Edits a balance correction (or the cash leg of an investment trade):
   * signed amount, date and note only. It stays an 'adjustment', so it is
   * never counted as income or spending and has no category.
   */
  updateAdjustment(actorId: string, txId: string, data: { amount: number; date: string; note: string }) {
    const actor = actorOf(actorId);
    const tx = get<{ created_by: string | null; flag: string | null; visibility: string; holder: string | null; currency: string; name: string }>(
      "SELECT t.created_by, t.flag, a.visibility, a.currency, a.name, COALESCE(a.holder_member_id, a.owner_member_id) AS holder FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.dompet_id = ?",
      [txId, actor.dompet_id],
    );
    if (!tx || tx.flag !== "adjustment") throw new Error("Koreksi tidak ditemukan.");
    if (!can.editTransaction(actor.role, tx.created_by === actor.id, tx.holder === actor.id)) throw new PermissionError("Anggota hanya bisa mengubah catatan sendiri.");
    if (!Number.isInteger(data.amount) || data.amount === 0) throw new Error("Jumlah koreksi tidak boleh 0.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error("Tanggal tidak valid.");
    const note = data.note.trim().slice(0, 140) || "Koreksi saldo";
    return write((run) => {
      run(
        `UPDATE transactions SET kind = ?, amount = ?, date = ?, note = ?, category_id = NULL, split_with = NULL, need = NULL,
           updated_by = ?, updated_at = datetime('now') WHERE id = ? AND dompet_id = ?`,
        [data.amount > 0 ? "income" : "expense", Math.abs(data.amount), data.date, note, actor.id, txId, actor.dompet_id],
      );
      if (tx.visibility === "shared") log(run, actor, `mengubah koreksi saldo ${tx.name} (${data.amount > 0 ? "+" : "−"}${formatMoney(Math.abs(data.amount), tx.currency)})`);
    });
  },

  deleteTransaction(actorId: string, txId: string) {
    const actor = actorOf(actorId);
    const tx = get<{ created_by: string | null; amount: number; note: string; visibility: string; holder: string | null; currency: string }>(
      "SELECT t.created_by, t.amount, t.note, a.visibility, a.currency, COALESCE(a.holder_member_id, a.owner_member_id) AS holder FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.dompet_id = ?",
      [txId, actor.dompet_id],
    );
    if (!tx) return Promise.resolve();
    if (!can.editTransaction(actor.role, tx.created_by === actor.id, tx.holder === actor.id)) throw new PermissionError("Anggota hanya bisa menghapus catatan sendiri.");
    const rows = snapshot("transactions", "id = ?", [txId]);
    return write((run) => {
      run("DELETE FROM transactions WHERE id = ?", [txId]);
      if (tx.visibility === "shared") log(run, actor, `menghapus transaksi ${formatMoney(tx.amount, tx.currency)}`);
      return putInTrash(run, actor.dompet_id, actor.id, `transaksi ${formatMoney(tx.amount, tx.currency)}${tx.note ? ` · ${tx.note}` : ""}`, [rows]);
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

  // --- goals ---------------------------------------------------------------
  saveGoal(
    actorId: string,
    data: { id?: string; name: string; icon: string; target: number; target_date: string | null; account_id: string | null; saved: number },
  ) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengatur tujuan.");
    if (!Number.isInteger(data.target) || data.target <= 0) throw new Error("Target harus lebih dari 0.");
    if (!Number.isInteger(data.saved) || data.saved < 0) throw new Error("Jumlah terkumpul tidak valid.");
    if (data.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.target_date)) throw new Error("Tanggal tidak valid.");
    const acc = data.account_id ? q.accounts(actor.dompet_id, actor.id).find((a) => a.id === data.account_id) : null;
    if (data.account_id && !acc) throw new Error("Akun tidak ditemukan.");
    const name = requireText(data.name, "Nama tujuan");
    const icon = data.icon || "🎯";
    return write((run) => {
      if (data.id) {
        run("UPDATE goals SET name = ?, icon = ?, target = ?, target_date = ?, account_id = ?, saved = ? WHERE id = ? AND dompet_id = ?", [
          name, icon, data.target, data.target_date, data.account_id, data.saved, data.id, actor.dompet_id,
        ]);
      } else {
        run("INSERT INTO goals (id, dompet_id, name, icon, target, target_date, account_id, saved, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          uid(), actor.dompet_id, name, icon, data.target, data.target_date, data.account_id, data.saved, actor.id,
        ]);
        if (!acc || acc.visibility === "shared") log(run, actor, `membuat tujuan ${icon} ${name} ${formatIDR(data.target)}`);
      }
    });
  },

  /** Top up (positive) or take from (negative) a goal without a linked account. */
  adjustGoal(actorId: string, goalId: string, delta: number) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError("Peran 'Hanya lihat' tidak bisa menabung.");
    if (!Number.isInteger(delta) || delta === 0) throw new Error("Jumlah harus lebih dari 0.");
    const g = q.goals(actor.dompet_id, actor.id).find((x) => x.id === goalId);
    if (!g) throw new Error("Tujuan tidak ditemukan.");
    if (g.account_id) throw new Error("Tujuan ini mengikuti saldo akun. Transfer ke akunnya saja.");
    if (g.saved + delta < 0) throw new Error(`Terkumpul baru ${formatIDR(g.saved)}.`);
    return write((run) => {
      run("UPDATE goals SET saved = saved + ? WHERE id = ? AND dompet_id = ?", [delta, goalId, actor.dompet_id]);
      log(run, actor, delta > 0 ? `menabung ${formatIDR(delta)} untuk ${g.icon} ${g.name}` : `mengambil ${formatIDR(-delta)} dari tabungan ${g.icon} ${g.name}`);
    });
  },

  deleteGoal(actorId: string, goalId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    const rows = snapshot("goals", "id = ? AND dompet_id = ?", [goalId, actor.dompet_id]);
    return write((run) => {
      run("DELETE FROM goals WHERE id = ? AND dompet_id = ?", [goalId, actor.dompet_id]);
      return putInTrash(run, actor.dompet_id, actor.id, `tujuan ${String(rows.rows[0]?.name ?? "")}`, [rows]);
    });
  },

  deleteBudget(actorId: string, budgetId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    const rows = snapshot("budgets", "id = ? AND dompet_id = ?", [budgetId, actor.dompet_id]);
    return write((run) => {
      run("DELETE FROM budgets WHERE id = ? AND dompet_id = ?", [budgetId, actor.dompet_id]);
      return putInTrash(run, actor.dompet_id, actor.id, `anggaran ${String(rows.rows[0]?.name ?? "")}`, [rows]);
    });
  },
};
