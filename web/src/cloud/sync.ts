// Cloud sync: local SQLite is the fast cache, Supabase is the source of truth.
//
//   local write ──trigger──▶ outbox ──upload()──▶ Supabase (RLS decides)
//   Supabase ──realtime event──▶ pullAll() ──applyRemote()──▶ local SQLite
//
// Every existing mutation (forms, importer, recurring, loans) keeps writing to
// SQLite. The outbox triggers notice and the uploader pushes the rows. If the
// server rejects a change (permissions), the outbox is dropped and the local
// cache is re-pulled, so the screen always ends up showing the server's state.

import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { all, applyRemote, rawDb, setAfterWrite } from "../db/database";
import { MEMBER_COLOURS } from "../db/repo";
import { friendlyError, getPendingInvite, inviteCodeFromUrl, normalizePhone, phoneEmail, requireSupabase, setPendingInvite, stripInviteFromUrl } from "./client";
import { setSession } from "../lib/session";
import { applyHiddenFromAccount, setHiddenSaver } from "../lib/hooks";
import type { Role } from "../lib/permissions";

// Local table -> server table. Order matters for uploads of new rows.
const SYNCED = ["dompets", "members", "accounts", "categories", "loans", "recurring", "transactions", "budgets", "goals", "holdings", "activity"] as const;
type Synced = (typeof SYNCED)[number];
const SERVER: Record<Synced, string> = {
  dompets: "dompets", members: "dompet_members", accounts: "accounts", categories: "categories", loans: "loans",
  recurring: "recurring", transactions: "transactions", budgets: "budgets", goals: "goals", holdings: "holdings", activity: "activity",
};

// ---------------------------------------------------------------------------
// Observable state for the UI
// ---------------------------------------------------------------------------
export interface CloudState {
  status: "loading" | "signed-out" | "not-activated" | "ready";
  userId: string | null;
  email: string | null;
  syncing: boolean;
  error: string | null;
  /** App-level admin (can generate activation codes). */
  appAdmin: boolean;
  /** Paid-plan status per Dompet (empty when the server has no plans yet). */
  subs: Record<string, DompetSub>;
  /** My own plan ('bulanan' | 'tahunan' | 'gratis' | 'anggota' | null = legacy). */
  myPlan: string | null;
  myActiveUntil: string | null;
}
export interface DompetSub {
  /** ISO date the Dompet turns read-only; null = no expiry. */
  activeUntil: string | null;
  isActive: boolean;
}
let state: CloudState = { status: "loading", userId: null, email: null, syncing: false, error: null, appAdmin: false, subs: {}, myPlan: null, myActiveUntil: null };
const listeners = new Set<() => void>();
function setState(p: Partial<CloudState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export const cloudStore = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// ---------------------------------------------------------------------------
// Outbox triggers
// ---------------------------------------------------------------------------
function installOutbox() {
  const d = rawDb();
  d.exec("CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, op TEXT NOT NULL, row_id TEXT NOT NULL)");
  const guard = "WHEN NOT EXISTS (SELECT 1 FROM meta WHERE key = 'applying_remote')";
  for (const t of SYNCED) {
    // Inserts and updates are uploaded differently (see uploadOnce), so the
    // triggers record which one happened. Recreated on start to replace the
    // older single 'upsert' triggers.
    d.exec(`
      DROP TRIGGER IF EXISTS ob_${t}_ins;
      DROP TRIGGER IF EXISTS ob_${t}_upd;
      DROP TRIGGER IF EXISTS ob_${t}_del;
      CREATE TRIGGER ob_${t}_ins AFTER INSERT ON ${t} ${guard}
        BEGIN INSERT INTO outbox (tbl, op, row_id) VALUES ('${t}', 'insert', NEW.id); END;
      CREATE TRIGGER ob_${t}_upd AFTER UPDATE ON ${t} ${guard}
        BEGIN INSERT INTO outbox (tbl, op, row_id) VALUES ('${t}', 'update', NEW.id); END;
      CREATE TRIGGER ob_${t}_del AFTER DELETE ON ${t} ${guard}
        BEGIN INSERT INTO outbox (tbl, op, row_id) VALUES ('${t}', 'delete', OLD.id); END;
    `);
  }
}

// ---------------------------------------------------------------------------
// Local row -> server payload
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const iso = (sqliteUtc: unknown) => (typeof sqliteUtc === "string" ? new Date(sqliteUtc.replace(" ", "T") + "Z").toISOString() : undefined);
const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null]));

function toServer(t: Synced, r: Row): Row {
  switch (t) {
    case "accounts":
      return {
        ...pick(r, ["id", "dompet_id", "name", "type", "opening_balance", "colour", "icon", "visibility", "owner_member_id", "holder_member_id", "created_by"]),
        archived: !!r.archived,
        // Needs migration 20261119000000_account_currency.sql.
        currency: r.currency || "IDR",
        fx_rate: r.fx_rate ?? 1,
        // Multi-currency pockets (migration 20261128): only sent once the
        // server has the columns, or when used (then it fails loudly).
        ...(serverHasPockets || r.parent_id || r.fx_auto === 0 ? { parent_id: r.parent_id ?? null, fx_auto: r.fx_auto !== 0 } : {}),
      };
    case "categories":
      return pick(r, ["id", "dompet_id", "name", "icon", "colour", "kind", "parent_id", "sort_order"]);
    case "transactions":
      return {
        ...pick(r, ["id", "dompet_id", "account_id", "category_id", "kind", "amount", "date", "note", "flag", "loan_id", "recurring_id", "paid_by", "created_by", "updated_by"]),
        // Only sent when set, so servers without the transfers migration
        // keep accepting ordinary transactions.
        ...(r.transfer_id ? { transfer_id: r.transfer_id } : {}),
        // Split shares: always once the server has the column (so clearing a
        // split syncs too); before that only when set, which then fails loudly.
        ...(serverHasSplit || r.split_with ? { split_with: r.split_with ? JSON.parse(String(r.split_with)) : null } : {}),
        ...(serverHasDetails || r.need || r.merchant || r.receipt
          ? { need: r.need ?? null, merchant: r.merchant ?? null, receipt_path: r.receipt && !String(r.receipt).startsWith("data:") ? r.receipt : null }
          : {}),
        created_at: iso(r.created_at),
      };
    case "budgets":
      return {
        ...pick(r, ["id", "dompet_id", "name", "amount", "category_id", "member_id", "created_by"]),
        exclude_category_ids: r.exclude_category_ids ? JSON.parse(String(r.exclude_category_ids)) : [],
        category_ids: r.category_ids ? JSON.parse(String(r.category_ids)) : [],
        // Only sent when not monthly, so servers without the period migration keep working.
        ...(r.period && r.period !== "monthly" ? { period: r.period } : {}),
      };
    case "loans":
      return { ...pick(r, ["id", "dompet_id", "direction", "counterparty", "amount", "account_id", "start_date", "due_date", "note", "created_by"]), settled: !!r.settled };
    case "recurring":
      return {
        ...pick(r, ["id", "dompet_id", "name", "icon", "kind", "amount", "account_id", "category_id", "paid_by", "frequency", "every", "next_date", "end_date", "created_by"]),
        active: !!r.active,
      };
    case "goals":
      return pick(r, ["id", "dompet_id", "name", "icon", "target", "target_date", "account_id", "saved", "created_by"]);
    case "holdings":
      return {
        ...pick(r, ["id", "dompet_id", "account_id", "symbol", "name", "shares", "avg_price", "created_by"]),
        updated_at: iso(r.updated_at),
        // Crypto/gold/US (migration 20261129): only sent when not IDX, so
        // servers without the column keep accepting IDX stocks.
        ...(r.market && r.market !== "IDX" ? { market: r.market } : {}),
      };
    case "activity":
      return pick(r, ["id", "dompet_id", "member_id", "message"]);
    case "dompets":
      return pick(r, ["id", "name"]);
    case "members":
      return { id: r.id, display_name: r.name, emoji: r.emoji };
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
/** Set by pullAll: whether the server has dompets.period_start_day (migration 20261122). */
let serverHasPeriodStart = false;
/** Set by pullAll: whether the server has transactions.split_with (migration 20261123). */
let serverHasSplit = false;
/** Set by pullAll: whether the server has transactions.need/merchant/receipt_path (migration 20261124). */
let serverHasDetails = false;
/** Set by pullAll: whether the server has accounts.parent_id/fx_auto (migration 20261128). */
let serverHasPockets = false;
let uploading: Promise<void> | null = null;
let uploadAgain = false;

function scheduleUpload() {
  if (state.status !== "ready") return;
  if (uploading) {
    uploadAgain = true;
    return;
  }
  uploading = (async () => {
    do {
      uploadAgain = false;
      await uploadOnce();
    } while (uploadAgain);
  })().finally(() => {
    uploading = null;
    if (pullWanted) schedulePull();
  });
}

async function uploadOnce() {
  const sb = requireSupabase();
  // 'upsert' = rows queued by older app versions (treated as update-or-insert).
  type Op = "insert" | "update" | "upsert" | "delete";
  const ops = all<{ seq: number; tbl: Synced; op: Op; row_id: string }>("SELECT * FROM outbox ORDER BY seq");
  if (ops.length === 0) return;
  setState({ syncing: true });
  const maxSeq = ops[ops.length - 1].seq;

  // Group consecutive ops on the same table+op so batches keep FK order.
  const groups: { tbl: Synced; op: Op; ids: string[] }[] = [];
  for (const o of ops) {
    const g = groups[groups.length - 1];
    if (g && g.tbl === o.tbl && g.op === o.op) {
      if (!g.ids.includes(o.row_id)) g.ids.push(o.row_id);
    } else groups.push({ tbl: o.tbl, op: o.op, ids: [o.row_id] });
  }
  // A deleted Dompet takes everything with it on the server; skip its children.
  const deletedDompets = new Set(groups.filter((g) => g.tbl === "dompets" && g.op === "delete").flatMap((g) => g.ids));

  try {
    for (const g of groups) {
      const table = SERVER[g.tbl];
      if (g.op === "delete") {
        if (g.tbl === "members") continue; // membership changes go through RPCs
        if (g.tbl !== "dompets" && deletedDompets.size > 0) continue;
        for (let i = 0; i < g.ids.length; i += 200) {
          const { error } = await sb.from(table).delete().in("id", g.ids.slice(i, i + 200));
          if (error) throw error;
        }
        continue;
      }
      const placeholders = g.ids.map(() => "?").join(",");
      const rows = all<Row>(`SELECT * FROM ${g.tbl} WHERE id IN (${placeholders})`, g.ids);
      if (rows.length === 0) continue; // inserted then deleted before upload
      if (g.tbl === "dompets") {
        for (const r of rows) {
          // period_start_day only once the server has the column (see pullAll).
          const patch = serverHasPeriodStart ? { name: r.name, period_start_day: r.period_start_day ?? 1 } : { name: r.name };
          const { error } = await sb.from(table).update(patch).eq("id", r.id as string);
          if (error) throw error;
        }
        continue;
      }
      if (g.tbl === "members") {
        // Only your own display name/emoji can be edited on the server.
        for (const r of rows.filter((r) => r.user_id === state.userId)) {
          const { error } = await sb.from(table).update({ display_name: r.name, emoji: r.emoji }).eq("id", r.id as string);
          if (error) throw error;
        }
        continue;
      }
      // Postgres applies INSERT permission rules to an upsert even when it
      // only updates, which wrongly rejects e.g. an admin editing a member's
      // transaction. So new rows are inserted and changed rows are updated.
      const payload = rows.map((r) => toServer(g.tbl, r));
      const insertOne = async (row: Row) => {
        const { error } = await sb.from(table).insert(row);
        if (error && error.code === "23505") return updateOne(row, false); // already uploaded
        if (error) throw error;
      };
      const updateOne = async (row: Row, insertIfMissing: boolean): Promise<void> => {
        const { id, ...changes } = row;
        const { data, error } = await sb.from(table).update(changes).eq("id", id as string).select("id");
        if (error) throw error;
        if (!data || data.length === 0) {
          if (insertIfMissing) return insertOne(row);
          throw new Error("forbidden"); // row not visible/editable for this user
        }
      };
      if (g.op === "insert") {
        for (let i = 0; i < payload.length; i += 500) {
          const chunk = payload.slice(i, i + 500);
          const { error } = await sb.from(table).insert(chunk);
          if (error && error.code === "23505") {
            for (const row of chunk) await insertOne(row);
          } else if (error) throw error;
        }
      } else if (g.tbl !== "activity") {
        for (const row of payload) await updateOne(row, g.op === "upsert");
      }
    }
    await applyRemote((run) => run("DELETE FROM outbox WHERE seq <= ?", [maxSeq]));
    setState({ syncing: false, error: null });
  } catch (e) {
    // Server said no: drop local changes and show the server's truth again.
    const message = friendlyError(e);
    console.error("Sedompet upload failed", e);
    await applyRemote((run) => run("DELETE FROM outbox"));
    setState({ syncing: false, error: message });
    window.dispatchEvent(new CustomEvent("sedompet:sync-error", { detail: message }));
    await pullAll();
  }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------
let pullTimer: number | undefined;
let pullWanted = false;

export function schedulePull(delay = 600) {
  pullWanted = true;
  if (uploading) return; // runs after the upload finishes
  clearTimeout(pullTimer);
  pullTimer = window.setTimeout(() => {
    pullWanted = false;
    pullAll().catch((e) => setState({ error: friendlyError(e) }));
  }, delay);
}

async function fetchAll(table: string, order = "id"): Promise<Row[]> {
  const sb = requireSupabase();
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from(table).select("*").order(order).range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data as Row[]));
    if (!data || data.length < page) break;
  }
  return out;
}

const sqliteTime = (ts: unknown) => (ts ? new Date(String(ts)).toISOString().slice(0, 19).replace("T", " ") : null);

export async function pullAll(): Promise<void> {
  if (state.status !== "ready" && state.status !== "loading") return;
  if (all<{ n: number }>("SELECT count(*) AS n FROM outbox")[0]?.n) {
    scheduleUpload();
    pullWanted = true;
    return;
  }
  setState({ syncing: true });
  const [dompets, members, accounts, categories, loans, recurring, transactions, budgets, goals, holdings] = await Promise.all([
    fetchAll("dompets"), fetchAll("dompet_members"), fetchAll("accounts"), fetchAll("categories"), fetchAll("loans"),
    fetchAll("recurring"), fetchAll("transactions"), fetchAll("budgets"),
    // Servers without the goals / holdings migration yet: none rather than no sync.
    fetchAll("goals").catch(() => [] as Row[]),
    fetchAll("holdings").catch(() => [] as Row[]),
  ]);
  const { data: activity, error: actErr } = await requireSupabase().from("activity").select("*").order("created_at", { ascending: false }).limit(500);
  if (actErr) throw actErr;
  // Admin rights can change while the app is open; refresh with every pull.
  const { data: isAdmin } = await requireSupabase().rpc("is_app_admin");
  if ((isAdmin === true) !== state.appAdmin) setState({ appAdmin: isAdmin === true });

  await applyRemote((run) => {
    run("DELETE FROM dompets"); // cascades to every child table
    serverHasPeriodStart = dompets.length > 0 && "period_start_day" in dompets[0];
    for (const d of dompets)
      run("INSERT INTO dompets (id, name, currency, period_start_day, created_at) VALUES (?, ?, ?, ?, ?)", [
        d.id as string, d.name as string, d.currency as string, Number(d.period_start_day ?? 1) || 1, sqliteTime(d.created_at),
      ]);
    members.forEach((m, i) =>
      run("INSERT INTO members (id, dompet_id, name, role, colour, emoji, user_id, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        m.id as string, m.dompet_id as string, ((m.display_name as string) || "Anggota").slice(0, 40), m.role as string,
        (m.colour as string) || MEMBER_COLOURS[i % MEMBER_COLOURS.length], (m.emoji as string) || "🙂", (m.user_id as string) ?? null, (m.phone as string) ?? null, sqliteTime(m.joined_at),
      ]),
    );
    if (accounts.length > 0) serverHasPockets = "parent_id" in accounts[0];
    // Pocket main accounts before their currencies (foreign key).
    const accs = [...accounts].sort((x, y) => Number(!!x.parent_id) - Number(!!y.parent_id));
    const accIds = new Set(accs.map((a) => a.id));
    for (const a of accs)
      run(
        `INSERT INTO accounts (id, dompet_id, name, type, opening_balance, currency, fx_rate, fx_auto, parent_id, colour, icon, visibility, owner_member_id, holder_member_id, archived, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.id, a.dompet_id, a.name, a.type, a.opening_balance, (a.currency as string) || "IDR", a.fx_rate == null ? 1 : Number(a.fx_rate),
          a.fx_auto === false ? 0 : 1, a.parent_id && accIds.has(a.parent_id) ? a.parent_id : null,
          a.colour, a.icon, a.visibility, a.owner_member_id, a.holder_member_id ?? null, a.archived ? 1 : 0, a.created_by, sqliteTime(a.created_at)] as (string | number | null)[],
      );
    const cats = [...categories].sort((x, y) => Number(!!x.parent_id) - Number(!!y.parent_id));
    for (const c of cats)
      run("INSERT INTO categories (id, dompet_id, name, icon, colour, kind, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        c.id, c.dompet_id, c.name, c.icon, c.colour, c.kind, c.parent_id, c.sort_order,
      ] as (string | number | null)[]);
    for (const l of loans)
      run(
        `INSERT INTO loans (id, dompet_id, direction, counterparty, amount, account_id, start_date, due_date, note, settled, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.id, l.dompet_id, l.direction, l.counterparty, l.amount, l.account_id, l.start_date, l.due_date, l.note, l.settled ? 1 : 0, l.created_by, sqliteTime(l.created_at)] as (string | number | null)[],
      );
    for (const r of recurring)
      run(
        `INSERT INTO recurring (id, dompet_id, name, icon, kind, amount, account_id, category_id, paid_by, frequency, every, next_date, end_date, active, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.dompet_id, r.name, r.icon, r.kind, r.amount, r.account_id, r.category_id, r.paid_by, r.frequency, r.every, r.next_date, r.end_date, r.active ? 1 : 0, r.created_by, sqliteTime(r.created_at)] as (string | number | null)[],
      );
    if (transactions.length > 0) {
      serverHasSplit = "split_with" in transactions[0];
      serverHasDetails = "merchant" in transactions[0];
    }
    for (const t of transactions)
      run(
        `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, flag, loan_id, recurring_id, transfer_id, split_with, need, merchant, receipt, paid_by, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.dompet_id, t.account_id, t.category_id, t.kind, t.amount, t.date, t.note, t.flag, t.loan_id, t.recurring_id, t.transfer_id ?? null,
          Array.isArray(t.split_with) && t.split_with.length ? JSON.stringify(t.split_with) : null,
          (t.need as string) ?? null, (t.merchant as string) ?? null, (t.receipt_path as string) ?? null,
          t.paid_by, t.created_by, t.updated_by, sqliteTime(t.created_at), sqliteTime(t.updated_at)] as (string | number | null)[],
      );
    for (const b of budgets)
      run("INSERT INTO budgets (id, dompet_id, name, amount, category_id, category_ids, member_id, exclude_category_ids, period, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        b.id, b.dompet_id, b.name, b.amount, b.category_id,
        Array.isArray(b.category_ids) && b.category_ids.length ? JSON.stringify(b.category_ids) : null,
        b.member_id,
        Array.isArray(b.exclude_category_ids) && b.exclude_category_ids.length ? JSON.stringify(b.exclude_category_ids) : null,
        (b.period as string) || "monthly",
        b.created_by, sqliteTime(b.created_at),
      ] as (string | number | null)[]);
    for (const g of goals)
      run("INSERT INTO goals (id, dompet_id, name, icon, target, target_date, account_id, saved, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        g.id, g.dompet_id, g.name, g.icon, g.target, g.target_date, g.account_id, g.saved, g.created_by, sqliteTime(g.created_at),
      ] as (string | number | null)[]);
    for (const h of holdings)
      run("INSERT INTO holdings (id, dompet_id, account_id, market, symbol, name, shares, avg_price, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        h.id, h.dompet_id, h.account_id, (h.market as string) || "IDX", h.symbol, h.name ?? null, Number(h.shares), Number(h.avg_price), h.created_by, sqliteTime(h.created_at), sqliteTime(h.updated_at),
      ] as (string | number | null)[]);
    for (const a of (activity ?? []) as Row[])
      run("INSERT INTO activity (id, dompet_id, member_id, message, created_at) VALUES (?, ?, ?, ?, ?)", [
        a.id, a.dompet_id, a.member_id, a.message, sqliteTime(a.created_at),
      ] as (string | number | null)[]);
  });
  setState({ syncing: false });
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
let channel: RealtimeChannel | null = null;

/** Loads plan status. Older servers without the RPC simply have no plans. */
export async function refreshSubscription() {
  const { data, error } = await requireSupabase().rpc("my_subscription");
  if (error || !Array.isArray(data)) return;
  const rows = data as { dompet_id: string; active_until: string | null; is_active: boolean; my_plan: string | null; my_active_until: string | null }[];
  setState({
    subs: Object.fromEntries(rows.map((r) => [r.dompet_id, { activeUntil: r.active_until, isActive: r.is_active }])),
    myPlan: rows[0]?.my_plan ?? null,
    myActiveUntil: rows[0]?.my_active_until ?? null,
  });
}

async function onSession(session: Session | null) {
  const sb = requireSupabase();
  if (!session) {
    channel?.unsubscribe();
    channel = null;
    setHiddenSaver(null);
    await applyRemote((run) => {
      run("DELETE FROM dompets");
      run("DELETE FROM outbox");
    });
    setSession({ dompetId: null, memberId: null });
    setState({ status: "signed-out", userId: null, email: null, syncing: false, appAdmin: false, subs: {}, myPlan: null, myActiveUntil: null });
    return;
  }
  const switchedUser = state.userId !== null && state.userId !== session.user.id;
  setState({ status: "loading", userId: session.user.id, email: session.user.email ?? null });
  // "Sembunyikan saldo" is remembered on the account, so it follows the user to other devices.
  const savedHide = session.user.user_metadata?.hide_balance;
  if (typeof savedHide === "boolean") applyHiddenFromAccount(savedHide);
  setHiddenSaver((v) => void sb.auth.updateUser({ data: { hide_balance: v } }));
  if (switchedUser) await applyRemote((run) => run("DELETE FROM outbox"));
  // Link any Dompet the admin pre-assigned to this phone number.
  const { error: claimError } = await sb.rpc("claim_phone_membership");
  if (claimError) {
    const msg = friendlyError(claimError);
    if (/belum diaktifkan|already|sudah dipakai/.test(msg)) {
      setState({ status: "not-activated", error: msg });
      return;
    }
    setState({ error: msg });
  }
  const { data: isAdmin } = await sb.rpc("is_app_admin");
  setState({ appAdmin: isAdmin === true });
  await refreshSubscription();
  try {
    await pullAll();
  } catch (e) {
    setState({ error: friendlyError(e) });
  }
  setState({ status: "ready" });
  touchLastSeen();
  void joinPendingInvite();
  scheduleUpload();
  if (!channel) {
    channel = sb
      .channel("sedompet-changes")
      .on("postgres_changes", { event: "*", schema: "public" }, () => schedulePull())
      .subscribe();
  }
}

/** If the person arrived through an invite link (or typed a code at sign-up), join now. */
async function joinPendingInvite() {
  const pending = getPendingInvite();
  if (!pending) return;
  // 8-char activation codes only matter at sign-up; nothing to join.
  if (pending.code.length !== 6) return setPendingInvite(null);
  setPendingInvite(null);
  try {
    await cloud.joinWithCode(pending.code, pending.name);
    window.dispatchEvent(new CustomEvent("sedompet:toast", { detail: "Berhasil bergabung ke Dompet keluarga" }));
  } catch (e) {
    window.dispatchEvent(new CustomEvent("sedompet:sync-error", { detail: friendlyError(e) }));
  }
}

/** Tell the server this person has the app open (admin "Terakhir buka"). Best effort. */
function touchLastSeen() {
  void requireSupabase()
    .rpc("touch_last_seen")
    .then(
      () => undefined,
      () => undefined,
    );
}

/** Call once at startup in cloud mode, after initDatabase("cloud"). */
export async function startCloudSync() {
  const sb = requireSupabase();
  // Remember an invite code from the link until the person is signed in.
  const linkCode = inviteCodeFromUrl();
  if (linkCode) {
    setPendingInvite({ code: linkCode, name: getPendingInvite()?.name });
    stripInviteFromUrl();
  }
  installOutbox();
  setAfterWrite(scheduleUpload);
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user.id !== state.userId) void onSession(session);
    if (event === "SIGNED_OUT") void onSession(null);
  });
  // Catch up when the tab comes back to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.status === "ready") {
      schedulePull(0);
      void refreshSubscription();
      touchLastSeen();
    }
  });
}

export interface ActivationCode {
  code: string;
  note: string | null;
  created_at: string;
  expires_at: string;
  revoked: boolean;
  used_phone: string | null;
  used_at: string | null;
  plan?: string | null;
  months?: number | null;
}

export interface PushPrefs {
  entries: boolean;
  bills: boolean;
  budget: boolean;
  weekly: boolean;
  plan: boolean;
}

export interface AppPhone {
  phone: string;
  activated: boolean;
  registered: boolean;
  is_admin: boolean;
  note: string | null;
  activated_at: string | null;
  last_sign_in_at: string | null;
  dompets: number;
  plan?: string | null;
  active_until?: string | null;
  /** Newest of PIN login / session refresh (needs 20261126 migration). */
  last_active_at?: string | null;
  /** Newest transaction this person created, any Dompet. */
  last_tx_at?: string | null;
}

export type PlanChoice = { plan: "bulanan" | "tahunan"; months: number } | { plan: "gratis" } | null;

// ---------------------------------------------------------------------------
// Auth + membership actions (server-side RPCs)
// ---------------------------------------------------------------------------
async function call<R extends { data: unknown; error: unknown }>(p: PromiseLike<R>): Promise<R["data"]> {
  const { data, error } = await p;
  if (error) throw new Error(friendlyError(error));
  return data;
}

export const cloud = {
  /** Phone + 6-digit PIN. */
  async signInPhone(phoneInput: string, pin: string) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("Nomor HP tidak valid. Contoh: 0812 3456 7890");
    if (!/^\d{6}$/.test(pin)) throw new Error("PIN harus 6 angka.");
    await call(requireSupabase().auth.signInWithPassword({ email: phoneEmail(phone), password: pin }));
  },
  /**
   * First-time sign-up; only works for numbers activated by the admin.
   * The account is created by the register_phone() database function, because
   * Supabase's public sign-up rejects the synthetic login address.
   */
  async signUpPhone(phoneInput: string, pin: string, inviteCode?: string, displayName?: string) {
    const phone = normalizePhone(phoneInput);
    if (!phone) throw new Error("Nomor HP tidak valid. Contoh: 0812 3456 7890");
    if (!/^\d{6}$/.test(pin)) throw new Error("PIN harus 6 angka.");
    const sb = requireSupabase();
    // A valid invite code activates the number and reserves the Dompet seat.
    const full = await sb.rpc("register_phone", { p_phone: phone, p_pin: pin, p_invite_code: inviteCode || null, p_display_name: displayName || null });
    if (full.error) {
      // Server not yet updated (older 2-argument function): works only without a code.
      const outdated = full.error.code === "PGRST202" || /Could not find the function/.test(full.error.message);
      if (!outdated) throw new Error(friendlyError(full.error));
      if (inviteCode) throw new Error("Server belum mendukung daftar dengan kode undangan. Admin perlu menjalankan SQL terbaru.");
      await call(sb.rpc("register_phone", { p_phone: phone, p_pin: pin }));
    }
    await call(sb.auth.signInWithPassword({ email: phoneEmail(phone), password: pin }));
  },
  async changePin(pin: string) {
    if (!/^\d{6}$/.test(pin)) throw new Error("PIN harus 6 angka.");
    await call(requireSupabase().auth.updateUser({ password: pin }));
  },
  async sendCode(email: string) {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Email tidak valid.");
    await call(requireSupabase().auth.signInWithOtp({ email: e, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } }));
  },
  async verifyCode(email: string, code: string) {
    await call(requireSupabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\s/g, ""), type: "email" }));
  },
  async signInWithGoogle() {
    const { error } = await requireSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) throw new Error(friendlyError(error));
  },
  async signOut() {
    await requireSupabase().auth.signOut();
  },

  /** Creates the Dompet on the server (seeds categories + cash account), sets your name. */
  async createDompet(name: string, yourName: string, emoji = "🙂") {
    const sb = requireSupabase();
    const d = await call(sb.rpc("create_dompet", { p_name: name.trim() }));
    const dompetId = (d as { id: string }).id;
    const member = await call(
      sb.from("dompet_members").update({ display_name: yourName.trim().slice(0, 60), emoji }).eq("dompet_id", dompetId).eq("user_id", state.userId!).select("id").single(),
    );
    await pullAll();
    const ownerId = (member as { id: string }).id;
    // First Dompet of this account: add the starter entry so the app isn't empty.
    if (all<{ n: number }>("SELECT count(*) AS n FROM dompets")[0]?.n === 1) {
      await refreshSubscription(); // now that there is a Dompet, the plan can be read
      const { addStarterData } = await import("../db/starter");
      await addStarterData(dompetId, ownerId, state.myPlan as never, state.myActiveUntil).catch((e) => console.warn("starter data", e));
    }
    setSession({ dompetId, memberId: ownerId }, { picked: true });
    return { dompetId, ownerId };
  },

  async joinWithCode(code: string, yourName?: string) {
    const sb = requireSupabase();
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleaned.length !== 6) throw new Error("Kode undangan terdiri dari 6 karakter.");
    const dompetId = (await call(sb.rpc("redeem_dompet_invite", { p_code: cleaned }))) as string;
    if (yourName?.trim()) {
      await call(sb.from("dompet_members").update({ display_name: yourName.trim().slice(0, 60) }).eq("dompet_id", dompetId).eq("user_id", state.userId!));
    }
    await pullAll();
    setSession({ dompetId, memberId: null }, { picked: true });
    return dompetId;
  },

  async createInvite(dompetId: string, role: Exclude<Role, "owner">) {
    const row = await call(requireSupabase().rpc("create_dompet_invite", { p_dompet_id: dompetId, p_role: role }));
    return row as { code: string; role: Role; expires_at: string; max_uses: number; uses: number };
  },
  async listInvites(dompetId: string) {
    const rows = await call(
      requireSupabase().from("dompet_invites").select("code, role, expires_at, max_uses, uses").eq("dompet_id", dompetId).eq("revoked", false).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    );
    return (rows as { code: string; role: Role; expires_at: string; max_uses: number; uses: number }[]).filter((r) => r.uses < r.max_uses);
  },
  async revokeInvite(code: string) {
    await call(requireSupabase().from("dompet_invites").update({ revoked: true }).eq("code", code));
  },
  async setRole(dompetId: string, userId: string, role: Role) {
    await call(requireSupabase().rpc("set_dompet_member_role", { p_dompet_id: dompetId, p_user_id: userId, p_role: role }));
    await pullAll();
  },
  async removeMember(dompetId: string, userId: string) {
    await call(requireSupabase().rpc("remove_dompet_member", { p_dompet_id: dompetId, p_user_id: userId }));
    await pullAll();
  },
  // --- Account holders & members who haven't joined ---------------------------
  async assignAccount(accountId: string, memberId: string | null, visibility: "shared" | "private", reassignPaidBy: boolean) {
    const n = (await call(
      requireSupabase().rpc("assign_account", { p_account_id: accountId, p_member_id: memberId, p_visibility: visibility, p_reassign_paid_by: reassignPaidBy }),
    )) as number;
    await pullAll();
    return n;
  },
  async addPendingMember(dompetId: string, phone: string, name: string, role: Exclude<Role, "owner">) {
    await call(requireSupabase().rpc("add_pending_member", { p_dompet_id: dompetId, p_phone: phone, p_display_name: name, p_role: role }));
    await pullAll();
  },
  async removePendingMember(memberId: string) {
    await call(requireSupabase().rpc("remove_pending_member", { p_member_id: memberId }));
    await pullAll();
  },

  // --- Receipt photos (private 'receipts' bucket, folder = Dompet id) ---------
  async uploadReceipt(dompetId: string, photo: Blob) {
    const path = `${dompetId}/${crypto.randomUUID()}.jpg`;
    const { error } = await requireSupabase().storage.from("receipts").upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (error) {
      if (/bucket not found|not found/i.test(error.message)) throw new Error("Server belum mendukung foto nota. Admin perlu menjalankan SQL 20261124000000_transaction_details.sql.");
      throw new Error(friendlyError(error));
    }
    return path;
  },
  /** Short-lived link to show a receipt photo. */
  async receiptUrl(path: string) {
    const { data, error } = await requireSupabase().storage.from("receipts").createSignedUrl(path, 60 * 60);
    if (error) throw new Error(friendlyError(error));
    return data.signedUrl;
  },

  // --- Push notifications ------------------------------------------------------
  async pushPublicKey() {
    const { data, error } = await requireSupabase().from("app_config").select("value").eq("key", "vapid_public_key").maybeSingle();
    if (error) {
      if (/app_config|does not exist|schema cache/i.test(error.message)) return null;
      throw new Error(friendlyError(error));
    }
    return (data?.value as string | undefined) ?? null;
  },
  async pushSubscribe(sub: PushSubscriptionJSON, prefs: PushPrefs) {
    await call(
      requireSupabase().rpc("push_subscribe", {
        p_endpoint: sub.endpoint,
        p_p256dh: sub.keys?.p256dh,
        p_auth: sub.keys?.auth,
        p_prefs: prefs,
        p_user_agent: navigator.userAgent,
      }),
    );
  },
  async pushPrefs(endpoint: string) {
    const { data } = await requireSupabase().from("push_subscriptions").select("prefs").eq("endpoint", endpoint).maybeSingle();
    return (data?.prefs as PushPrefs | undefined) ?? null;
  },
  async pushSetPrefs(endpoint: string, prefs: PushPrefs) {
    await call(requireSupabase().rpc("push_set_prefs", { p_endpoint: endpoint, p_prefs: prefs }));
  },
  async pushUnsubscribe(endpoint: string) {
    await call(requireSupabase().rpc("push_unsubscribe", { p_endpoint: endpoint }));
  },

  // --- App admin -------------------------------------------------------------
  async createActivationCode(note: string, plan: PlanChoice = null) {
    const args: Record<string, unknown> = { p_note: note.trim() || null, p_valid_days: 30 };
    // Plan arguments only when chosen, so servers without plans keep working.
    if (plan) Object.assign(args, { p_plan: plan.plan, p_months: plan.plan === "gratis" ? null : plan.months });
    const { data, error } = await requireSupabase().rpc("app_create_activation_code", args);
    if (error) {
      const outdated = error.code === "PGRST202" || /Could not find the function/.test(error.message);
      if (plan && outdated) throw new Error("Server belum mendukung paket. Jalankan SQL 20261121000000_subscription.sql dulu, atau pilih 'Tanpa paket'.");
      throw new Error(friendlyError(error));
    }
    return data as ActivationCode;
  },
  /** Extend (adds to what's left), make free, or end ('berhenti') a number's plan. */
  async setSubscription(phone: string, plan: "bulanan" | "tahunan" | "gratis" | "berhenti", months?: number) {
    await call(requireSupabase().rpc("app_set_subscription", { p_phone: phone, p_plan: plan, p_months: months ?? null }));
    await refreshSubscription();
  },
  async listActivationCodes() {
    return ((await call(requireSupabase().rpc("app_list_activation_codes"))) ?? []) as ActivationCode[];
  },
  async revokeActivationCode(code: string) {
    await call(requireSupabase().rpc("app_revoke_activation_code", { p_code: code }));
  },
  async listPhones() {
    return ((await call(requireSupabase().rpc("app_list_phones"))) ?? []) as AppPhone[];
  },
  async setPhoneActive(phone: string, active: boolean) {
    await call(requireSupabase().rpc("app_set_phone_active", { p_phone: phone, p_active: active }));
  },

  async leaveDompet(dompetId: string) {
    await call(requireSupabase().rpc("leave_dompet", { p_dompet_id: dompetId }));
    setSession({ dompetId: null, memberId: null });
    await pullAll();
  },
};
