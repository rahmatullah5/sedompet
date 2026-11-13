// Neraca (balance sheet): what the family owns minus what it owes, in rupiah.
//
//   Harta  = every visible account's balance (credit cards excluded)
//          + piutang: money lent out and not repaid yet
//   Utang  = credit-card balances owed (negative balance on a 'credit' account)
//          + utang: money borrowed and not repaid yet
//
// Works "as of" a date, so the change since last month and a short trend can
// be shown. Private accounts count only for their owner (same as everywhere).

import { all } from "./database";
import { baseSql } from "../lib/currency";
import { todayISO } from "../lib/format";

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
              FROM transactions t WHERE t.account_id = a.id AND ($upto IS NULL OR t.date <= $upto)), 0))`)} AS balance_base
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
