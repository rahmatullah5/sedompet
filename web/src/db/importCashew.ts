// Import a Cashew backup (.sql / .sqlite, schema v40+) into the current Dompet.
// Runs entirely in the browser; the file is never uploaded anywhere.
//
// Mapping:
//   wallets               -> accounts (shared; type guessed from the name)
//   categories            -> categories; subcategories keep their parent
//   transactions          -> transactions; amount sign gives the kind
//     paired (transfers)  -> flag 'transfer' (balance only, not spending)
//     "Balance Correction"-> flag 'adjustment'
//     loan objective      -> loans + flag 'loan'
//     unpaid/upcoming     -> skipped
//   budgets (monthly)     -> budgets; weekly/custom ones are skipped
//
// IDs are derived from (Dompet, Cashew id), so importing the same backup twice
// does not create duplicates.

import { openForeign, write } from "./database";
import { q } from "./repo";
import { can, PermissionError } from "../lib/permissions";
import { toISODate } from "../lib/format";
import type { SqlValue } from "sql.js";

export interface ImportSummary {
  accounts: number;
  categories: number;
  transactions: number;
  transfers: number;
  adjustments: number;
  loans: number;
  budgets: number;
  skipped: { unpaid: number; zero: number; budgets: number; goals: number };
}

// Cashew's built-in icon file names -> emoji. Unknown ones fall back to keywords.
const ICONS: Record<string, string> = {
  cutlery: "🍽️", bread: "🍞", shopping: "🛍️", gift: "🎁", popcorn: "🍿", bills: "🧾", tram: "🚋",
  flower: "🌸", plane: "✈️", rent: "🏠", "motor-bike": "🏍️", bookshelf: "📚", tablet: "📱", weight: "🏋️",
  charts: "📈", coin: "🪙", tie: "👔", groceries: "🛒", coffee: "☕", car: "🚗", bus: "🚌", gas: "⛽",
  fuel: "⛽", health: "💊", pill: "💊", medicine: "💊", baby: "👶", school: "🎒", education: "🎓", book: "📚",
  game: "🎮", music: "🎵", movie: "🎬", phone: "📱", wifi: "📶", internet: "📶", electricity: "💡", water: "🚰",
  house: "🏠", home: "🏠", pet: "🐾", dog: "🐶", cat: "🐱", clothes: "👕", shirt: "👕", shoe: "👟", beauty: "💄",
  salary: "💼", money: "💰", wallet: "👛", bank: "🏦", "credit-card": "💳", card: "💳", piggy: "🐷", savings: "🐷",
  insurance: "🛡️", tax: "🧾", charity: "🤲", donation: "🤲", travel: "🧳", hotel: "🏨", sport: "⚽", gym: "🏋️",
  drink: "🥤", beer: "🍺", pizza: "🍕", burger: "🍔", fast: "🍔", taxi: "🚕", train: "🚆", bike: "🚲", tools: "🔧",
  repair: "🔧", computer: "💻", laptop: "💻", electronic: "🔌", subscription: "🔁", streaming: "📺", tv: "📺",
};

function iconFor(emoji: string | null, iconName: string | null, fallback: string) {
  if (emoji && emoji.trim()) return emoji.trim();
  if (iconName) {
    const base = iconName.replace(/\.png$/i, "").replace(/\(\d+\)$/, "").toLowerCase();
    if (ICONS[base]) return ICONS[base];
    for (const [k, v] of Object.entries(ICONS)) if (base.includes(k)) return v;
  }
  return fallback;
}

/** Cashew stores colours as "0xffRRGGBB". */
function colourFor(c: string | null, fallback: string) {
  const m = c?.match(/^0x[0-9a-f]{2}([0-9a-f]{6})$/i);
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

function guessAccountType(name: string): "cash" | "bank" | "ewallet" | "savings" {
  const n = name.toLowerCase();
  if (/(gopay|ovo|dana|shopee|linkaja|spay|e-?wallet|flip|jenius pay)/.test(n)) return "ewallet";
  if (/(cash|tunai|dompet|kas\b)/.test(n)) return "cash";
  if (/(tabung|saving|invest|deposit|emas|gold|reksa|saham|stock)/.test(n)) return "savings";
  return "bank";
}

/** Deterministic UUID (SHA-1 based, v5 layout) so re-imports are idempotent. */
async function stableId(...parts: string[]) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(parts.join("|")))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function rows<T>(db: ReturnType<typeof openForeign>, sql: string): T[] {
  const res = db.exec(sql)[0];
  if (!res) return [];
  return res.values.map((v: SqlValue[]) => Object.fromEntries(res.columns.map((c: string, i: number) => [c, v[i]])) as T);
}

function hasTable(db: ReturnType<typeof openForeign>, name: string) {
  return rows<{ n: number }>(db, `SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='${name}'`)[0]?.n === 1;
}

export async function importCashew(actorId: string, bytes: Uint8Array): Promise<ImportSummary> {
  const actor = q.member(actorId);
  if (!actor || !can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengimpor data.");

  let src: ReturnType<typeof openForeign>;
  try {
    src = openForeign(bytes);
  } catch {
    throw new Error("File ini bukan database SQLite.");
  }
  try {
    if (!["wallets", "categories", "transactions"].every((t) => hasTable(src, t))) {
      throw new Error("Format file backup ini belum didukung.");
    }
    const d = actor.dompet_id;
    const id = (kind: string, pk: string) => stableId("cashew", d, kind, pk);

    type W = { wallet_pk: string; name: string; colour: string | null; emoji_icon_name: string | null; archived: number };
    type C = { category_pk: string; name: string; colour: string | null; icon_name: string | null; emoji_icon_name: string | null; income: number; main_category_pk: string | null; order: number };
    type T = {
      transaction_pk: string; paired_transaction_fk: string | null; name: string; amount: number; note: string; category_fk: string;
      sub_category_fk: string | null; wallet_fk: string; date_created: number; income: number; paid: number; objective_loan_fk: string | null;
    };
    type O = { objective_pk: string; type: number; name: string; amount: number; date_created: number; end_date: number | null; income: number; archived: number; wallet_fk: string };
    type B = { budget_pk: string; name: string; amount: number; period_length: number; reoccurrence: number | null; category_fks: string | null; category_fks_exclude: string | null; archived: number };

    const wallets = rows<W>(src, "SELECT wallet_pk, name, colour, emoji_icon_name, archived FROM wallets ORDER BY \"order\"");
    const cats = rows<C>(src, "SELECT category_pk, name, colour, icon_name, emoji_icon_name, income, main_category_pk, \"order\" FROM categories ORDER BY main_category_pk IS NOT NULL, \"order\"");
    const txs = rows<T>(src, `SELECT transaction_pk, paired_transaction_fk, name, amount, note, category_fk, sub_category_fk, wallet_fk,
                                     date_created, income, paid, ${hasColumn(src, "transactions", "objective_loan_fk") ? "objective_loan_fk" : "NULL AS objective_loan_fk"}
                              FROM transactions`);
    const loans = hasTable(src, "objectives") ? rows<O>(src, "SELECT objective_pk, type, name, amount, date_created, end_date, income, archived, wallet_fk FROM objectives") : [];
    const budgets = hasTable(src, "budgets") ? rows<B>(src, `SELECT budget_pk, name, amount, period_length, reoccurrence, category_fks,
                                              ${hasColumn(src, "budgets", "category_fks_exclude") ? "category_fks_exclude" : "NULL AS category_fks_exclude"}, archived FROM budgets`) : [];

    // Pre-compute ids (async) before the synchronous write transaction.
    const accId = new Map<string, string>();
    for (const w of wallets) accId.set(w.wallet_pk, await id("wallet", w.wallet_pk));
    const catId = new Map<string, string>();
    for (const c of cats) catId.set(c.category_pk, await id("category", c.category_pk));
    const loanId = new Map<string, string>();
    for (const o of loans.filter((o) => o.type === 1)) loanId.set(o.objective_pk, await id("loan", o.objective_pk));
    const txId = new Map<string, string>();
    for (const t of txs) txId.set(t.transaction_pk, await id("tx", t.transaction_pk));
    const budgetId = new Map<string, string>();
    for (const b of budgets) budgetId.set(b.budget_pk, await id("budget", b.budget_pk));

    const BALANCE_CORRECTION = "0";
    const date = (sec: number) => toISODate(new Date(sec * 1000));
    const summary: ImportSummary = {
      accounts: 0, categories: 0, transactions: 0, transfers: 0, adjustments: 0, loans: 0, budgets: 0,
      skipped: { unpaid: 0, zero: 0, budgets: 0, goals: loans.filter((o) => o.type !== 1).length },
    };

    await write((run) => {
      for (const w of wallets) {
        run(
          `INSERT OR IGNORE INTO accounts (id, dompet_id, name, type, opening_balance, colour, icon, visibility, archived, created_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, 'shared', ?, ?)`,
          [accId.get(w.wallet_pk)!, d, w.name.slice(0, 40) || "Akun", guessAccountType(w.name), colourFor(w.colour, "#f47c5a"), w.emoji_icon_name || null, w.archived ? 1 : 0, actor.id],
        );
        summary.accounts++;
      }

      // Parents first (query is ordered), then subcategories. A subcategory
      // always takes its parent's kind (Cashew allows them to differ).
      const incomeOf = new Map(cats.map((c) => [c.category_pk, c.income]));
      for (const c of cats) {
        const income = c.main_category_pk ? (incomeOf.get(c.main_category_pk) ?? c.income) : c.income;
        if (c.category_pk === BALANCE_CORRECTION) continue;
        const parent = c.main_category_pk ? catId.get(c.main_category_pk) ?? null : null;
        run(
          `INSERT OR IGNORE INTO categories (id, dompet_id, name, icon, colour, kind, parent_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [catId.get(c.category_pk)!, d, c.name.slice(0, 40) || "Kategori", iconFor(c.emoji_icon_name, c.icon_name, income ? "💰" : "📦"), colourFor(c.colour, "#b29d8b"), income ? "income" : "expense", parent, 100 + (c.order ?? 0)],
        );
        summary.categories++;
      }

      for (const o of loans.filter((o) => o.type === 1)) {
        const account = accId.get(o.wallet_fk) ?? accId.values().next().value;
        if (!account) continue;
        run(
          `INSERT OR IGNORE INTO loans (id, dompet_id, direction, counterparty, amount, account_id, start_date, due_date, note, settled, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
          [loanId.get(o.objective_pk)!, d, o.income ? "lent" : "borrowed", o.name.slice(0, 60) || "Pinjaman", Math.max(1, Math.round(Math.abs(o.amount))), account, date(o.date_created), o.end_date ? date(o.end_date) : null, o.archived ? 1 : 0, actor.id],
        );
        summary.loans++;
      }

      for (const t of txs) {
        if (!t.paid) {
          summary.skipped.unpaid++;
          continue;
        }
        const amount = Math.round(Math.abs(t.amount));
        if (amount === 0) {
          summary.skipped.zero++;
          continue;
        }
        const account = accId.get(t.wallet_fk);
        if (!account) continue;
        const isTransfer = !!t.paired_transaction_fk;
        const isAdjustment = t.category_fk === BALANCE_CORRECTION;
        const loan = t.objective_loan_fk ? loanId.get(t.objective_loan_fk) ?? null : null;
        const flag = isTransfer ? "transfer" : isAdjustment ? "adjustment" : loan ? "loan" : null;
        const category = flag === "transfer" || flag === "adjustment" ? null : (t.sub_category_fk && catId.get(t.sub_category_fk)) || catId.get(t.category_fk) || null;
        const title = (t.name || "").trim();
        const extra = (t.note || "").trim();
        const note = [title, extra && extra !== title ? extra : ""].filter(Boolean).join(" · ").slice(0, 140);
        run(
          `INSERT OR IGNORE INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, loan_id, paid_by, created_by, updated_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'))`,
          [txId.get(t.transaction_pk)!, d, account, category, t.amount < 0 ? "expense" : "income", amount, date(t.date_created), note, flag, loan, actor.id, actor.id, actor.id, t.date_created],
        );
        summary.transactions++;
        if (flag === "transfer") summary.transfers++;
        if (flag === "adjustment") summary.adjustments++;
      }

      for (const b of budgets) {
        const monthly = b.reoccurrence === 3 && b.period_length === 1;
        if (!monthly || b.archived) {
          summary.skipped.budgets++;
          continue;
        }
        let catList: string[] = [];
        try {
          catList = JSON.parse(b.category_fks || "[]");
        } catch {
          /* ignore */
        }
        const category = catList.length === 1 ? catId.get(catList[0]) ?? null : null;
        let excludeList: string[] = [];
        try {
          excludeList = JSON.parse(b.category_fks_exclude || "[]");
        } catch {
          /* ignore */
        }
        const excludes = excludeList.map((pk) => catId.get(pk)).filter((x): x is string => !!x);
        run(
          `INSERT OR IGNORE INTO budgets (id, dompet_id, name, amount, category_id, member_id, exclude_category_ids, created_by) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
          [budgetId.get(b.budget_pk)!, d, b.name.slice(0, 40) || "Anggaran", Math.max(1, Math.round(b.amount)), category, !category && excludes.length ? JSON.stringify(excludes) : null, actor.id],
        );
        summary.budgets++;
      }

      // Mark imported loans as settled when fully repaid.
      run(
        `UPDATE loans SET settled = 1 WHERE dompet_id = ? AND settled = 0 AND amount <= COALESCE((
           SELECT SUM(t.amount) FROM transactions t WHERE t.loan_id = loans.id
             AND t.kind = CASE loans.direction WHEN 'lent' THEN 'income' ELSE 'expense' END), 0)`,
        [d],
      );
      run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [
        crypto.randomUUID(), d, actor.id, `mengimpor ${summary.transactions} transaksi dari file backup`,
      ]);
    });
    return summary;
  } finally {
    src.close();
  }
}

function hasColumn(db: ReturnType<typeof openForeign>, table: string, column: string) {
  return rows<{ name: string }>(db, `PRAGMA table_info(${table})`).some((r) => r.name === column);
}
