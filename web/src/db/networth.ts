// Neraca (balance sheet): what the family owns minus what it owes, in rupiah.
//
//   Harta  = every visible account's balance (credit cards excluded), stocks
//            at their live price
//          + piutang: money lent out and not repaid yet
//   Utang  = credit-card balances owed (negative balance on a 'credit' account)
//          + utang: money borrowed and not repaid yet
//
// Works "as of" a date, so the change since last month and a short trend can
// be shown. Private accounts count only for their owner (same as everywhere).

import { all } from "./database";
import { baseSql, holdingsSql } from "../lib/currency";
import { todayISO } from "../lib/format";
import { isInvestmentMove } from "./repo";

const VISIBLE = `(a.visibility = 'shared' OR a.owner_member_id = $me)`;

export interface NetWorthLine {
  id: string;
  name: string;
  /** Account type key, or 'piutang' / 'utang' for loans. */
  type: string;
  icon: string | null;
  amount: number;
  /** Member whose it is (holder / private owner / lender); null = shared. */
  ownerId: string | null;
  private: boolean;
}

export interface NetWorth {
  assets: NetWorthLine[];
  liabilities: NetWorthLine[];
  totalAssets: number;
  totalLiabilities: number;
  net: number;
}

/** Net worth on `upTo` (inclusive, YYYY-MM-DD); null = today. */
export function netWorth(dompetId: string, me: string, upTo: string | null = null): NetWorth {
  // "Now" = up to today: entries dated later don't count yet.
  const params = { $d: dompetId, $me: me, $upto: upTo ?? todayISO() };
  const accounts = all<{
    id: string; name: string; type: string; icon: string | null; visibility: string;
    owner: string | null; balance_base: number;
  }>(
    `SELECT a.id, a.name, a.type, a.icon, a.visibility,
            COALESCE(a.holder_member_id, a.owner_member_id) AS owner,
            ${baseSql(`(a.opening_balance + COALESCE((
              SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
              FROM transactions t WHERE t.account_id = a.id AND ($upto IS NULL OR t.date <= $upto)), 0))`)}
            + ${holdingsSql("a", "$upto")} AS balance_base
     FROM accounts a
     WHERE a.dompet_id = $d AND a.archived = 0 AND ${VISIBLE}
     ORDER BY a.visibility = 'private', a.created_at`,
    params,
  );
  // Loans: principal minus repayments (repayment = opposite kind on the loan's account).
  const loans = all<{
    id: string; counterparty: string; direction: "lent" | "borrowed"; visibility: string; owner: string | null; remaining: number;
  }>(
    `SELECT l.id, l.counterparty, l.direction, a.visibility,
            COALESCE(a.holder_member_id, a.owner_member_id, l.created_by) AS owner,
            ${baseSql(`(l.amount - COALESCE((
              SELECT SUM(t.amount) FROM transactions t
              WHERE t.loan_id = l.id AND t.kind = CASE l.direction WHEN 'lent' THEN 'income' ELSE 'expense' END
                AND ($upto IS NULL OR t.date <= $upto)), 0))`)} AS remaining
     FROM loans l JOIN accounts a ON a.id = l.account_id
     WHERE l.dompet_id = $d AND ${VISIBLE} AND l.settled = 0
       AND ($upto IS NULL OR l.start_date <= $upto)`,
    params,
  );

  const assets: NetWorthLine[] = [];
  const liabilities: NetWorthLine[] = [];
  for (const a of accounts) {
    const line = { id: a.id, name: a.name, type: a.type, icon: a.icon, ownerId: a.owner, private: a.visibility === "private" };
    if (a.type === "credit") {
      if (a.balance_base < 0) liabilities.push({ ...line, amount: -a.balance_base });
      else if (a.balance_base > 0) assets.push({ ...line, amount: a.balance_base });
    } else assets.push({ ...line, amount: a.balance_base });
  }
  for (const l of loans) {
    if (l.remaining <= 0) continue;
    const line = { id: l.id, name: l.counterparty, icon: null, amount: l.remaining, ownerId: l.owner, private: l.visibility === "private" };
    if (l.direction === "lent") assets.push({ ...line, type: "piutang" });
    else liabilities.push({ ...line, type: "utang" });
  }
  const totalAssets = assets.reduce((s, x) => s + x.amount, 0);
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);
  return { assets, liabilities, totalAssets, totalLiabilities, net: totalAssets - totalLiabilities };
}

export interface CashFlow {
  /** Real income / spending (not transfers, corrections or loans). */
  income: number;
  expense: number;
  /** Balance corrections (Koreksi saldo). Signed: + adds to balances. */
  adjustments: number;
  /** Cash moved by buying (−) and selling (+) stocks, crypto or gold. */
  investments: number;
  /** The entries behind `adjustments` / `investments`, largest first. */
  adjustmentItems: MoveItem[];
  investmentItems: MoveItem[];
  loans: number;
  /** Transfers net (0 unless one side is an account you can't see). */
  transfers: number;
  /** Opening balances of accounts created inside the period. */
  newAccounts: number;
  /** Change in the value of recorded stocks/crypto/gold (holdings added in the period, at today's price). */
  investedChange: number;
  startBalance: number;
  endBalance: number;
  /** startBalance + every movement - endBalance; 0 when everything adds up. */
  gap: number;
}

export interface MoveItem {
  id: string;
  date: string;
  account: string;
  note: string | null;
  /** Rupiah, signed: + adds to balances. */
  amount: number;
}


/**
 * Arus kas between two dates (inclusive), in rupiah, over every account you
 * can see (archived ones too, so the sums close).
 */
export function cashFlow(dompetId: string, me: string, from: string, to: string): CashFlow {
  const p = { $d: dompetId, $me: me, $from: from, $to: to };
  const signed = `CASE t.kind WHEN 'income' THEN ${baseSql("t.amount")} ELSE -${baseSql("t.amount")} END`;
  const flows = all<{ flag: string | null; kind: string; total: number }>(
    `SELECT t.flag, t.kind, SUM(${baseSql("t.amount")}) AS total
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.dompet_id = $d AND ${VISIBLE} AND t.date BETWEEN $from AND $to
     GROUP BY t.flag, t.kind`,
    p,
  );
  const sum = (flag: string | null, kind?: string) =>
    flows.filter((f) => f.flag === flag && (!kind || f.kind === kind)).reduce((s, f) => s + (f.kind === "income" ? f.total : -f.total), 0);
  const income = flows.filter((f) => f.flag === null && f.kind === "income").reduce((s, f) => s + f.total, 0);
  const expense = flows.filter((f) => f.flag === null && f.kind === "expense").reduce((s, f) => s + f.total, 0);

  // Opening balances count from the day the account was created.
  const created = `substr(a.created_at, 1, 10)`;
  // Investments count in the balances too (at today's price; a holding counts
  // from the day it was recorded), so moving cash into them isn't a loss.
  const bal = all<{ start: number; fresh: number; finish: number; inv_start: number; inv_end: number }>(
    `SELECT
       COALESCE(SUM(${holdingsSql("a", "date($from, '-1 day')")}), 0) AS inv_start,
       COALESCE(SUM(${holdingsSql("a", "$to")}), 0) AS inv_end,
       COALESCE(SUM(CASE WHEN ${created} < $from THEN ${baseSql("a.opening_balance")} ELSE 0 END), 0)
         + COALESCE((SELECT SUM(${signed}) FROM transactions t JOIN accounts a ON a.id = t.account_id
                     WHERE t.dompet_id = $d AND ${VISIBLE} AND t.date < $from), 0) AS start,
       COALESCE(SUM(CASE WHEN ${created} BETWEEN $from AND $to THEN ${baseSql("a.opening_balance")} ELSE 0 END), 0) AS fresh,
       COALESCE(SUM(CASE WHEN ${created} <= $to THEN ${baseSql("a.opening_balance")} ELSE 0 END), 0)
         + COALESCE((SELECT SUM(${signed}) FROM transactions t JOIN accounts a ON a.id = t.account_id
                     WHERE t.dompet_id = $d AND ${VISIBLE} AND t.date <= $to), 0) AS finish
     FROM accounts a WHERE a.dompet_id = $d AND ${VISIBLE}`,
    p,
  )[0] ?? { start: 0, fresh: 0, finish: 0, inv_start: 0, inv_end: 0 };
  const investedChange = bal.inv_end - bal.inv_start;

  // Adjustments are both Koreksi saldo and the cash leg of investment trades.
  const items = all<MoveItem>(
    `SELECT t.id, t.date, a.name AS account, t.note,
            CASE t.kind WHEN 'income' THEN ${baseSql("t.amount")} ELSE -${baseSql("t.amount")} END AS amount
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.dompet_id = $d AND ${VISIBLE} AND t.flag = 'adjustment' AND t.date BETWEEN $from AND $to
     ORDER BY ABS(amount) DESC, t.date DESC`,
    p,
  );
  const investmentItems = items.filter((i) => isInvestmentMove(i.note));
  const adjustmentItems = items.filter((i) => !isInvestmentMove(i.note));
  const investments = investmentItems.reduce((s, i) => s + i.amount, 0);
  const adjustments = sum("adjustment") - investments;
  const loans = sum("loan");
  const transfers = sum("transfer");
  const moved = income - expense + adjustments + investments + loans + transfers + bal.fresh + investedChange;
  const startBalance = bal.start + bal.inv_start;
  const endBalance = bal.finish + bal.inv_end;
  return {
    income, expense, adjustments, investments, adjustmentItems, investmentItems, loans, transfers,
    newAccounts: bal.fresh,
    investedChange,
    startBalance,
    endBalance,
    gap: Math.round(startBalance + moved - endBalance),
  };
}
