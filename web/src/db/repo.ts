// Typed queries and permission-checked mutations over the SQLite database.

import { all, get, write } from "./database";
import { can, PermissionError, type Role } from "../lib/permissions";
import { formatIDR } from "../lib/format";

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

export type AccountType = "cash" | "bank" | "ewallet" | "savings";

export interface Account {
  id: string;
  dompet_id: string;
  name: string;
  type: AccountType;
  opening_balance: number;
  colour: string;
  icon: string | null;
  visibility: "shared" | "private";
  owner_member_id: string | null;
  holder_member_id: string | null;
  holder_name: string | null;
  holder_emoji: string | null;
  holder_colour: string | null;
  balance: number;
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
  paid_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  // joined
  account_name: string;
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
  category_name: string | null;
  category_icon: string | null;
  member_name: string | null;
  member_emoji: string | null;
  spent: number;
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
/** Spending stats ignore transfers and balance corrections. */
const REAL = `t.flag IS NULL`;
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
    all<Account>(
      `SELECT a.*, h.name AS holder_name, h.emoji AS holder_emoji, h.colour AS holder_colour,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END)
           FROM transactions t WHERE t.account_id = a.id), 0) AS balance
       FROM accounts a
       LEFT JOIN members h ON h.id = COALESCE(a.holder_member_id, a.owner_member_id)
       WHERE a.dompet_id = $d AND a.archived = 0 AND ${VISIBLE_ACCOUNT}
       ORDER BY a.visibility = 'private', a.created_at`,
      { $d: dompetId, $me: me },
    ),

  categories: (dompetId: string, kind?: Kind) =>
    all<Category>(
      `SELECT * FROM categories WHERE dompet_id = $d AND ($k IS NULL OR kind = $k)
       ORDER BY kind DESC, parent_id IS NOT NULL, sort_order, name`,
      { $d: dompetId, $k: kind ?? null },
    ),

  transactions(
    dompetId: string,
    me: string,
    f: { month?: string; paidBy?: string; categoryId?: string; accountId?: string; kind?: Kind; limit?: number } = {},
  ) {
    return all<Transaction>(
      `SELECT t.*, a.name AS account_name, a.visibility AS account_visibility,
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
      },
    );
  },

  monthTotals(dompetId: string, me: string, month: string) {
    return (
      get<{ income: number; expense: number }>(
        `SELECT COALESCE(SUM(CASE WHEN t.kind='income' THEN t.amount END), 0) AS income,
                COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount END), 0) AS expense
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.dompet_id = $d AND ${VISIBLE_ACCOUNT} AND ${REAL} AND substr(t.date, 1, 7) = $month`,
        { $d: dompetId, $me: me, $month: month },
      ) ?? { income: 0, expense: 0 }
    );
  },

  spendingByMember(dompetId: string, me: string, month: string) {
    return all<{ id: string; name: string; emoji: string; colour: string; total: number }>(
      `SELECT m.id, m.name, m.emoji, m.colour,
              COALESCE(SUM(t.amount), 0) AS total
       FROM members m
       LEFT JOIN transactions t ON t.paid_by = m.id AND t.kind = 'expense' AND ${REAL}
         AND substr(t.date, 1, 7) = $month
         AND t.account_id IN (SELECT a.id FROM accounts a WHERE a.dompet_id = $d AND ${VISIBLE_ACCOUNT})
       WHERE m.dompet_id = $d
       GROUP BY m.id ORDER BY total DESC`,
      { $d: dompetId, $me: me, $month: month },
    );
  },

  spendingByCategory(dompetId: string, me: string, month: string) {
    return all<{ id: string | null; name: string; icon: string; colour: string; total: number }>(
      `SELECT top.id, COALESCE(top.name, 'Tanpa kategori') AS name, COALESCE(top.icon, '📦') AS icon,
              COALESCE(top.colour, '#b29d8b') AS colour, SUM(t.amount) AS total
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
  budgets(dompetId: string, month: string) {
    return all<Budget>(
      `SELECT b.*, c.name AS category_name, c.icon AS category_icon,
              m.name AS member_name, m.emoji AS member_emoji,
              COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                JOIN accounts a ON a.id = t.account_id AND a.visibility = 'shared'
                LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.dompet_id = b.dompet_id AND t.kind = 'expense' AND ${REAL}
                  AND substr(t.date, 1, 7) = $month
                  AND (b.category_id IS NULL OR t.category_id = b.category_id OR c.parent_id = b.category_id)
                  AND (b.exclude_category_ids IS NULL OR (
                        COALESCE(t.category_id, '') NOT IN (SELECT value FROM json_each(b.exclude_category_ids))
                    AND COALESCE(c.parent_id, '') NOT IN (SELECT value FROM json_each(b.exclude_category_ids))))
                  AND (b.member_id IS NULL OR t.paid_by = b.member_id)
              ), 0) AS spent
       FROM budgets b
       LEFT JOIN categories c ON c.id = b.category_id
       LEFT JOIN members m ON m.id = b.member_id
       WHERE b.dompet_id = $d
       ORDER BY b.member_id IS NOT NULL, b.category_id IS NOT NULL, b.name`,
      { $d: dompetId, $month: month },
    );
  },

  /** Income/expense per month, oldest first, for the last `months` months. */
  monthlySeries(dompetId: string, me: string, months: string[]) {
    const rows = all<{ month: string; income: number; expense: number }>(
      `SELECT substr(t.date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN t.kind='income' THEN t.amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount END), 0) AS expense
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
      `SELECT CAST(substr(t.date, 9, 2) AS INTEGER) AS day, SUM(t.amount) AS total
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
              SUM(CASE t.kind WHEN 'income' THEN t.amount ELSE -t.amount END) AS net
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
    data: { id?: string; name: string; type: AccountType; opening_balance: number; colour: string; icon?: string | null; visibility: "shared" | "private"; holder_member_id?: string | null },
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
    return write((run) => {
      if (data.id) {
        run(
          `UPDATE accounts SET name = ?, type = ?, opening_balance = ?, colour = ?, icon = ?, visibility = ?,
             owner_member_id = CASE WHEN ? = 'private' THEN COALESCE(owner_member_id, ?) ELSE NULL END
           WHERE id = ? AND dompet_id = ?`,
          [name, data.type, data.opening_balance, data.colour, data.icon ?? null, data.visibility, data.visibility, actor.id, data.id, actor.dompet_id],
        );
        // Holder changes on shared accounts are an admin decision.
        if (can.manage(actor.role) && data.visibility === "shared" && data.holder_member_id !== undefined) {
          run("UPDATE accounts SET holder_member_id = ? WHERE id = ? AND dompet_id = ?", [data.holder_member_id, data.id, actor.dompet_id]);
        }
        log(run, actor, `mengubah akun ${name}`);
      } else {
        run(
          `INSERT INTO accounts (id, dompet_id, name, type, opening_balance, colour, icon, visibility, owner_member_id, holder_member_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uid(), actor.dompet_id, name, data.type, data.opening_balance, data.colour, data.icon ?? null, data.visibility,
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
        log(run, actor, `mengoreksi saldo ${acc.name} menjadi ${formatIDR(Math.round(actualBalance))} (${diff > 0 ? "+" : "−"}${formatIDR(Math.abs(diff))})`);
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
    const acc = get<{ visibility: string; owner_member_id: string | null }>(
      "SELECT visibility, owner_member_id FROM accounts WHERE id = ? AND dompet_id = ?",
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
    const what = `${data.kind === "expense" ? "pengeluaran" : "pemasukan"} ${formatIDR(data.amount)}${cat ? ` · ${cat.icon} ${cat.name}` : ""}${payer && payer.id !== actor.id ? ` (dibayar ${payer.name})` : ""}`;

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

  deleteTransaction(actorId: string, txId: string) {
    const actor = actorOf(actorId);
    const tx = get<{ created_by: string | null; amount: number; visibility: string; holder: string | null }>(
      "SELECT t.created_by, t.amount, a.visibility, COALESCE(a.holder_member_id, a.owner_member_id) AS holder FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = ? AND t.dompet_id = ?",
      [txId, actor.dompet_id],
    );
    if (!tx) return Promise.resolve();
    if (!can.editTransaction(actor.role, tx.created_by === actor.id, tx.holder === actor.id)) throw new PermissionError("Anggota hanya bisa menghapus catatan sendiri.");
    return write((run) => {
      run("DELETE FROM transactions WHERE id = ?", [txId]);
      if (tx.visibility === "shared") log(run, actor, `menghapus transaksi ${formatIDR(tx.amount)}`);
    });
  },

  // --- budgets -------------------------------------------------------------
  saveBudget(actorId: string, data: { id?: string; name: string; amount: number; category_id: string | null; member_id: string | null; exclude_category_ids?: string[] }) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError("Hanya pemilik/admin yang bisa mengatur anggaran.");
    if (!Number.isInteger(data.amount) || data.amount <= 0) throw new Error("Jumlah harus lebih dari 0.");
    const name = requireText(data.name, "Nama anggaran");
    const excludes = !data.category_id && data.exclude_category_ids?.length ? JSON.stringify(data.exclude_category_ids) : null;
    return write((run) => {
      if (data.id) {
        run("UPDATE budgets SET name = ?, amount = ?, category_id = ?, member_id = ?, exclude_category_ids = ? WHERE id = ? AND dompet_id = ?", [
          name, data.amount, data.category_id, data.member_id, excludes, data.id, actor.dompet_id,
        ]);
        log(run, actor, `mengubah anggaran ${name} menjadi ${formatIDR(data.amount)}`);
      } else {
        run("INSERT INTO budgets (id, dompet_id, name, amount, category_id, member_id, exclude_category_ids, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
          uid(), actor.dompet_id, name, data.amount, data.category_id, data.member_id, excludes, actor.id,
        ]);
        log(run, actor, `membuat anggaran ${name} ${formatIDR(data.amount)}/bulan`);
      }
    });
  },

  deleteBudget(actorId: string, budgetId: string) {
    const actor = actorOf(actorId);
    if (!can.manage(actor.role)) throw new PermissionError();
    return write((run) => run("DELETE FROM budgets WHERE id = ? AND dompet_id = ?", [budgetId, actor.dompet_id]));
  },
};
