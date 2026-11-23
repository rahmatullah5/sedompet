// Loans (utang/piutang) and recurring items (langganan, tagihan, gaji).

import { all, get, write } from "./database";
import { putInTrash, snapshot } from "./trash";
import { q, type Kind } from "./repo";
import { can, PermissionError } from "../lib/permissions";
import { toISODate, todayISO } from "../lib/format";
import { baseSql, formatMoney } from "../lib/currency";

const uid = () => crypto.randomUUID();
const VISIBLE = `(a.visibility = 'shared' OR a.owner_member_id = $me)`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type LoanDirection = "lent" | "borrowed";

export interface Loan {
  id: string;
  dompet_id: string;
  direction: LoanDirection;
  counterparty: string;
  amount: number;
  account_id: string;
  account_name: string;
  account_currency: string;
  start_date: string;
  due_date: string | null;
  note: string;
  settled: number;
  created_by: string | null;
  created_by_name: string | null;
  repaid: number;
}

export type Frequency = "weekly" | "monthly" | "yearly";

export interface Recurring {
  id: string;
  dompet_id: string;
  name: string;
  icon: string | null;
  kind: Kind;
  amount: number;
  account_id: string;
  account_name: string;
  account_currency: string;
  account_visibility: "shared" | "private";
  /** `amount` in rupiah. */
  amount_base: number;
  category_id: string | null;
  category_icon: string | null;
  category_name: string | null;
  paid_by: string | null;
  paid_by_name: string | null;
  frequency: Frequency;
  every: number;
  next_date: string;
  end_date: string | null;
  active: number;
}

export const FREQ_LABEL: Record<Frequency, string> = { weekly: "minggu", monthly: "bulan", yearly: "tahun" };

export function describeFrequency(f: Frequency, every: number) {
  return every === 1 ? `Tiap ${FREQ_LABEL[f]}` : `Tiap ${every} ${FREQ_LABEL[f]}`;
}

/** Next occurrence after `iso`. Month/year steps clamp to the month's last day (31 Jan -> 28 Feb). */
export function advanceDate(iso: string, f: Frequency, every: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (f === "weekly") return toISODate(new Date(y, m - 1, d + 7 * every));
  const months = f === "monthly" ? every : 12 * every;
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return toISODate(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
}

/** All occurrence dates of an item between [from, to] inclusive. */
export function occurrences(r: Pick<Recurring, "next_date" | "end_date" | "frequency" | "every" | "active">, from: string, to: string) {
  const out: string[] = [];
  if (!r.active) return out;
  let date = r.next_date;
  let guard = 0;
  while (date <= to && guard++ < 500) {
    if (r.end_date && date > r.end_date) break;
    if (date >= from) out.push(date);
    date = advanceDate(date, r.frequency, r.every);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const mq = {
  loans(dompetId: string, me: string) {
    // Principal: lent => expense, borrowed => income. Repayment is the opposite kind.
    return all<Loan>(
      `SELECT l.*, a.name AS account_name, COALESCE(a.currency, 'IDR') AS account_currency, cb.name AS created_by_name,
              COALESCE((SELECT SUM(t.amount) FROM transactions t
                        WHERE t.loan_id = l.id
                          AND t.kind = CASE l.direction WHEN 'lent' THEN 'income' ELSE 'expense' END), 0) AS repaid
       FROM loans l
       JOIN accounts a ON a.id = l.account_id
       LEFT JOIN members cb ON cb.id = l.created_by
       WHERE l.dompet_id = $d AND ${VISIBLE}
       ORDER BY l.settled, COALESCE(l.due_date, '9999'), l.start_date DESC`,
      { $d: dompetId, $me: me },
    );
  },

  recurring(dompetId: string, me: string) {
    return all<Recurring>(
      `SELECT r.*, a.name AS account_name, COALESCE(a.currency, 'IDR') AS account_currency, a.visibility AS account_visibility, ${baseSql("r.amount")} AS amount_base, c.icon AS category_icon, c.name AS category_name,
              p.name AS paid_by_name
       FROM recurring r
       JOIN accounts a ON a.id = r.account_id
       LEFT JOIN categories c ON c.id = r.category_id
       LEFT JOIN members p ON p.id = r.paid_by
       WHERE r.dompet_id = $d AND ${VISIBLE}
       ORDER BY r.active DESC, r.next_date`,
      { $d: dompetId, $me: me },
    );
  },

  /** Transactions recorded from a rutin item ("Bayar"/"Terima") in a date range. */
  recurringPaid(dompetId: string, me: string, from: string, to: string) {
    return all<{ recurring_id: string; date: string; amount_base: number; kind: Kind }>(
      `SELECT t.recurring_id, t.date, ${baseSql("t.amount")} AS amount_base, t.kind
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.dompet_id = $d AND ${VISIBLE} AND t.recurring_id IS NOT NULL AND t.date BETWEEN $from AND $to`,
      { $d: dompetId, $me: me, $from: from, $to: to },
    );
  },

  /** Active items due today or earlier. */
  due(dompetId: string, me: string) {
    const today = todayISO();
    return mq.recurring(dompetId, me).filter((r) => r.active && r.next_date <= today && (!r.end_date || r.next_date <= r.end_date));
  },
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
function actorOf(id: string) {
  const m = q.member(id);
  if (!m) throw new PermissionError("Pilih anggota dulu.");
  return m;
}

function visibleAccount(actor: { id: string; dompet_id: string }, accountId: string) {
  const a = get<{ name: string; visibility: string; owner_member_id: string | null; currency: string }>(
    "SELECT name, visibility, owner_member_id, currency FROM accounts WHERE id = ? AND dompet_id = ?",
    [accountId, actor.dompet_id],
  );
  if (!a) throw new Error("Pilih akun.");
  if (a.visibility === "private" && a.owner_member_id !== actor.id) throw new PermissionError("Itu akun pribadi orang lain.");
  return a;
}

function logIfShared(run: (sql: string, p?: (string | number | null)[]) => void, visibility: string, actor: { id: string; dompet_id: string }, message: string) {
  if (visibility !== "shared") return;
  run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [uid(), actor.dompet_id, actor.id, message]);
}

function insertTx(
  run: (sql: string, p?: (string | number | null)[]) => void,
  actor: { id: string; dompet_id: string },
  t: { account_id: string; category_id?: string | null; kind: Kind; amount: number; date: string; note: string; flag?: string | null; loan_id?: string | null; recurring_id?: string | null; paid_by?: string | null },
) {
  run(
    `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, loan_id, recurring_id, paid_by, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid(), actor.dompet_id, t.account_id, t.category_id ?? null, t.kind, t.amount, t.date, t.note.slice(0, 140), t.flag ?? null, t.loan_id ?? null, t.recurring_id ?? null, t.paid_by ?? actor.id, actor.id, actor.id],
  );
}

function checkAmount(n: number) {
  if (!Number.isInteger(n) || n <= 0) throw new Error("Jumlah harus lebih dari 0.");
}

export const mm = {
  // --- loans ---------------------------------------------------------------
  createLoan(actorId: string, data: { direction: LoanDirection; counterparty: string; amount: number; account_id: string; start_date: string; due_date: string | null; note: string }) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError();
    checkAmount(data.amount);
    const who = data.counterparty.trim();
    if (!who) throw new Error("Isi nama orangnya.");
    const acc = visibleAccount(actor, data.account_id);
    return write((run) => {
      const id = uid();
      run(
        `INSERT INTO loans (id, dompet_id, direction, counterparty, amount, account_id, start_date, due_date, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, actor.dompet_id, data.direction, who.slice(0, 60), data.amount, data.account_id, data.start_date, data.due_date, data.note.trim().slice(0, 140), actor.id],
      );
      insertTx(run, actor, {
        account_id: data.account_id,
        kind: data.direction === "lent" ? "expense" : "income",
        amount: data.amount,
        date: data.start_date,
        note: data.direction === "lent" ? `Pinjamkan ke ${who}` : `Pinjam dari ${who}`,
        flag: "loan",
        loan_id: id,
      });
      logIfShared(run, acc.visibility, actor, data.direction === "lent" ? `meminjamkan ${formatMoney(data.amount, acc.currency)} ke ${who}` : `meminjam ${formatMoney(data.amount, acc.currency)} dari ${who}`);
      return id;
    });
  },

  recordLoanPayment(actorId: string, loanId: string, data: { amount: number; account_id: string; date: string }) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError();
    checkAmount(data.amount);
    const loan = mq.loans(actor.dompet_id, actor.id).find((l) => l.id === loanId);
    if (!loan) throw new Error("Pinjaman tidak ditemukan.");
    const acc = visibleAccount(actor, data.account_id);
    if (acc.currency !== loan.account_currency) throw new Error(`Bayar dari akun ber-mata uang ${loan.account_currency}, sama seperti pinjamannya.`);
    const remaining = loan.amount - loan.repaid;
    return write((run) => {
      insertTx(run, actor, {
        account_id: data.account_id,
        kind: loan.direction === "lent" ? "income" : "expense",
        amount: data.amount,
        date: data.date,
        note: loan.direction === "lent" ? `Cicilan dari ${loan.counterparty}` : `Bayar utang ke ${loan.counterparty}`,
        flag: "loan",
        loan_id: loanId,
      });
      if (data.amount >= remaining) run("UPDATE loans SET settled = 1 WHERE id = ?", [loanId]);
      logIfShared(
        run,
        acc.visibility,
        actor,
        loan.direction === "lent"
          ? `menerima ${formatMoney(data.amount, acc.currency)} dari ${loan.counterparty}${data.amount >= remaining ? " (lunas)" : ""}`
          : `membayar utang ${formatMoney(data.amount, acc.currency)} ke ${loan.counterparty}${data.amount >= remaining ? " (lunas)" : ""}`,
      );
    });
  },

  setLoanSettled(actorId: string, loanId: string, settled: boolean) {
    const actor = actorOf(actorId);
    const loan = get<{ created_by: string | null }>("SELECT created_by FROM loans WHERE id = ? AND dompet_id = ?", [loanId, actor.dompet_id]);
    if (!loan || !can.editTransaction(actor.role, loan.created_by === actor.id)) throw new PermissionError();
    return write((run) => run("UPDATE loans SET settled = ? WHERE id = ?", [settled ? 1 : 0, loanId]));
  },

  deleteLoan(actorId: string, loanId: string) {
    const actor = actorOf(actorId);
    const loan = get<{ created_by: string | null; counterparty: string }>("SELECT created_by, counterparty FROM loans WHERE id = ? AND dompet_id = ?", [loanId, actor.dompet_id]);
    if (!loan) return Promise.resolve();
    if (!can.editTransaction(actor.role, loan.created_by === actor.id)) throw new PermissionError();
    // Its transactions go with it (ON DELETE CASCADE), so they go to the trash too.
    const entries = [snapshot("loans", "id = ?", [loanId]), snapshot("transactions", "loan_id = ?", [loanId])];
    return write((run) => {
      run("DELETE FROM loans WHERE id = ?", [loanId]);
      return putInTrash(run, actor.dompet_id, actor.id, `pinjaman ${loan.counterparty}`, entries);
    });
  },

  // --- recurring -----------------------------------------------------------
  saveRecurring(
    actorId: string,
    data: { id?: string; name: string; icon: string | null; kind: Kind; amount: number; account_id: string; category_id: string | null; paid_by: string | null; frequency: Frequency; every: number; next_date: string; end_date: string | null },
  ) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengatur tagihan rutin.");
    checkAmount(data.amount);
    const name = data.name.trim();
    if (!name) throw new Error("Isi namanya, mis. Netflix atau Gaji.");
    visibleAccount(actor, data.account_id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.next_date)) throw new Error("Tanggal tidak valid.");
    const every = Math.min(12, Math.max(1, Math.round(data.every) || 1));
    return write((run) => {
      if (data.id) {
        run(
          `UPDATE recurring SET name = ?, icon = ?, kind = ?, amount = ?, account_id = ?, category_id = ?, paid_by = ?,
             frequency = ?, every = ?, next_date = ?, end_date = ?, active = 1 WHERE id = ? AND dompet_id = ?`,
          [name, data.icon, data.kind, data.amount, data.account_id, data.category_id, data.paid_by, data.frequency, every, data.next_date, data.end_date, data.id, actor.dompet_id],
        );
      } else {
        run(
          `INSERT INTO recurring (id, dompet_id, name, icon, kind, amount, account_id, category_id, paid_by, frequency, every, next_date, end_date, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid(), actor.dompet_id, name, data.icon, data.kind, data.amount, data.account_id, data.category_id, data.paid_by, data.frequency, every, data.next_date, data.end_date, actor.id],
        );
        run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [
          uid(), actor.dompet_id, actor.id,
          `menambahkan ${data.kind === "expense" ? "tagihan rutin" : "pemasukan rutin"} ${name} ${formatMoney(data.amount, visibleAccount(actor, data.account_id).currency)}`,
        ]);
      }
    });
  },

  deleteRecurring(actorId: string, id: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    const rows = snapshot("recurring", "id = ? AND dompet_id = ?", [id, actor.dompet_id]);
    return write((run) => {
      run("DELETE FROM recurring WHERE id = ? AND dompet_id = ?", [id, actor.dompet_id]);
      return putInTrash(run, actor.dompet_id, actor.id, `rutin ${String(rows.rows[0]?.name ?? "")}`, [rows]);
    });
  },

  /** Record the due occurrence as a real transaction, then move to the next date. */
  recordRecurring(actorId: string, id: string, opts: { amount?: number; skip?: boolean } = {}) {
    const actor = actorOf(actorId);
    if (!can.addTransaction(actor.role)) throw new PermissionError();
    const r = mq.recurring(actor.dompet_id, actor.id).find((x) => x.id === id);
    if (!r) throw new Error("Tidak ditemukan.");
    const amount = opts.amount ?? r.amount;
    if (!opts.skip) checkAmount(amount);
    const acc = visibleAccount(actor, r.account_id);
    const next = advanceDate(r.next_date, r.frequency, r.every);
    return write((run) => {
      if (!opts.skip) {
        insertTx(run, actor, {
          account_id: r.account_id,
          category_id: r.category_id,
          kind: r.kind,
          amount,
          date: r.next_date,
          note: r.name,
          recurring_id: r.id,
          paid_by: r.paid_by ?? actor.id,
        });
        logIfShared(run, acc.visibility, actor, `${r.kind === "expense" ? "membayar" : "menerima"} ${r.name} ${formatMoney(amount, r.account_currency)}`);
      }
      const ended = r.end_date !== null && next > r.end_date;
      run("UPDATE recurring SET next_date = ?, active = ? WHERE id = ?", [next, ended ? 0 : 1, r.id]);
    });
  },
};

/** Sum of known future recurring flows between two dates (for forecasts). */
export function projectedRecurring(dompetId: string, me: string, from: string, to: string) {
  let income = 0;
  let expense = 0;
  const items: {
    date: string; name: string; kind: Kind; amount: number;
    category_id: string | null; paid_by: string | null; shared: boolean;
  }[] = [];
  for (const r of mq.recurring(dompetId, me)) {
    for (const date of occurrences(r, from, to)) {
      const base = r.amount_base;
      if (r.kind === "income") income += base;
      else expense += base;
      items.push({ date, name: r.name, kind: r.kind, amount: base, category_id: r.category_id, paid_by: r.paid_by, shared: r.account_visibility === "shared" });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { income, expense, items };
}

export { toISODate };

/** Non-recurring ("variable") income/expense between two dates, ignoring transfers/loans. */
export function variableTotals(dompetId: string, me: string, from: string, to: string) {
  // Income in a category that an active recurring income item uses (e.g. "Gaji")
  // is already forecast by that item, so it is left out of the average to avoid
  // counting the salary twice (common for history entered before the item existed).
  const recurringIncomeCats = mq
    .recurring(dompetId, me)
    .filter((r) => r.active && r.kind === "income" && r.category_id)
    .map((r) => r.category_id as string);
  const params: Record<string, string | null> = { $d: dompetId, $me: me, $from: from, $to: to };
  const names = recurringIncomeCats.map((id, i) => {
    params["$ric" + i] = id;
    return "$ric" + i;
  });
  const excludeIncome = names.length
    ? // COALESCE: a NULL parent/category must count as "not excluded", not NULL.
      "AND NOT (t.kind = 'income' AND (COALESCE(t.category_id, '') IN (" + names.join(",") + ") OR COALESCE(c.parent_id, '') IN (" + names.join(",") + ")))"
    : "";
  const row =
    get<{ income: number; expense: number }>(
      `SELECT COALESCE(SUM(CASE WHEN t.kind='income' THEN ${baseSql("t.amount")} END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind='expense' THEN ${baseSql("t.amount")} END), 0) AS expense
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.dompet_id = $d AND ${VISIBLE} AND t.flag IS NULL AND t.recurring_id IS NULL
         AND t.date BETWEEN $from AND $to
         ${excludeIncome}`,
      params,
    ) ?? { income: 0, expense: 0 };
  return { ...row, excludedIncomeCategories: recurringIncomeCats.length };
}
