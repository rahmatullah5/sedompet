// In-browser SQLite (sql.js / WASM) with IndexedDB persistence.
//
// - The whole database lives in memory; after every write the file bytes are
//   saved to IndexedDB, so a reload keeps the data.
// - A BroadcastChannel tells other tabs to reload. Open two tabs, act as
//   different family members, and changes show up in both: a local stand-in
//   for real multi-device sync.

import initSqlJs, { type Database, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { COLUMN_UPGRADES, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

const IDB_NAME = "sedompet";
const IDB_STORE = "files";
// Demo (offline) and cloud (Supabase cache) data live in separate files.
let IDB_KEY = "db.sqlite";
let CHANNEL_NAME = "sedompet-db";

type Params = Record<string, SqlValue> | SqlValue[];

let db: Database | null = null;
let version = 0;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
/** Called after every local write is saved (cloud mode uploads the outbox). */
let afterWrite: (() => void) | null = null;
export function setAfterWrite(fn: (() => void) | null) {
  afterWrite = fn;
}
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

// ---------------------------------------------------------------------------
// IndexedDB file storage
// ---------------------------------------------------------------------------
// One shared connection per tab. It closes itself when another tab (or
// devtools) wants to delete/upgrade the database, so it never blocks them.
let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => {
        const conn = req.result;
        conn.onversionchange = () => {
          conn.close();
          idbPromise = null;
        };
        resolve(conn);
      };
      req.onerror = () => {
        idbPromise = null;
        reject(req.error);
      };
    });
  }
  return idbPromise;
}

async function idbGet(): Promise<Uint8Array | null> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const req = idb.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(bytes: Uint8Array | null): Promise<void> {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (bytes) store.put(bytes, IDB_KEY);
    else store.delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function open(bytes: Uint8Array | null): Database {
  if (!SQL) throw new Error("sql.js not initialised");
  const next = new SQL.Database(bytes ?? undefined);
  next.exec(SCHEMA_SQL);
  for (const [table, column, definition] of COLUMN_UPGRADES) {
    const cols = next.exec(`PRAGMA table_info(${table})`)[0]?.values.map((r) => r[1]) ?? [];
    if (!cols.includes(column)) next.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  next.exec("CREATE INDEX IF NOT EXISTS categories_parent ON categories(parent_id)");
  relaxAccountType(next);
  next.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", [
    String(SCHEMA_VERSION),
  ]);
  return next;
}

/**
 * Older databases only allowed four account types. SQLite can't drop a CHECK
 * constraint, so rebuild the table (foreign keys off, so nothing cascades).
 */
function relaxAccountType(d: Database) {
  const sql = String(d.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounts'")[0]?.values[0]?.[0] ?? "");
  if (!sql.includes("type IN ('cash'")) return;
  const cols = (d.exec("PRAGMA table_info(accounts)")[0]?.values ?? []).map((r) => String(r[1])).join(", ");
  d.exec("PRAGMA foreign_keys = OFF");
  try {
    d.exec("BEGIN");
    d.exec(sql.replace(/CREATE TABLE (IF NOT EXISTS )?"?accounts"?/, "CREATE TABLE accounts_new").replace(/CHECK \(type IN \([^)]*\)\)/, "CHECK (length(type) BETWEEN 1 AND 30)"));
    d.exec(`INSERT INTO accounts_new (${cols}) SELECT ${cols} FROM accounts`);
    d.exec("DROP TABLE accounts");
    d.exec("ALTER TABLE accounts_new RENAME TO accounts");
    d.exec("CREATE INDEX IF NOT EXISTS accounts_dompet ON accounts(dompet_id)");
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    console.error("accounts upgrade failed", e);
  } finally {
    d.exec("PRAGMA foreign_keys = ON");
  }
}

function notify() {
  version++;
  listeners.forEach((l) => l());
}

export async function initDatabase(file: "demo" | "cloud" = "demo"): Promise<void> {
  if (db) return;
  IDB_KEY = file === "cloud" ? "cloud.sqlite" : "db.sqlite";
  CHANNEL_NAME = `sedompet-${file}`;
  channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
  SQL = await initSqlJs({ locateFile: () => wasmUrl });
  db = open(await idbGet());

  channel?.addEventListener("message", async (event) => {
    if (event.data === "changed") {
      const bytes = await idbGet();
      db?.close();
      db = open(bytes);
      notify();
    }
  });
}

function requireDb(): Database {
  if (!db) throw new Error("Database not ready");
  return db;
}

async function persist() {
  await idbPut(requireDb().export());
  channel?.postMessage("changed");
}

// ---------------------------------------------------------------------------
// React subscription (useSyncExternalStore)
// ---------------------------------------------------------------------------
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion() {
  return version;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
export function all<T>(sql: string, params: Params = []): T[] {
  const stmt = requireDb().prepare(sql);
  try {
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function get<T>(sql: string, params: Params = []): T | undefined {
  return all<T>(sql, params)[0];
}

/**
 * Runs `fn` inside one SQLite transaction, then saves and notifies.
 * Throwing inside `fn` rolls everything back.
 */
export async function write<T>(fn: (run: (sql: string, params?: Params) => void) => T): Promise<T> {
  const d = requireDb();
  d.exec("BEGIN");
  let result: T;
  try {
    result = fn((sql, params = []) => d.run(sql, params));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  notify();
  await persist();
  afterWrite?.();
  return result;
}

/** Applies server data without recording it in the outbox. */
export async function applyRemote(fn: (run: (sql: string, params?: Params) => void) => void): Promise<void> {
  const d = requireDb();
  d.exec("BEGIN");
  try {
    d.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('applying_remote', '1')");
    fn((sql, params = []) => d.run(sql, params));
    d.run("DELETE FROM meta WHERE key = 'applying_remote'");
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  notify();
  await persist();
}

/** Raw access for the sync engine. */
export function rawDb(): Database {
  return requireDb();
}

// ---------------------------------------------------------------------------
// File import / export / reset
// ---------------------------------------------------------------------------
/** Opens some other SQLite file (e.g. a Cashew backup) read-only, in memory. */
export function openForeign(bytes: Uint8Array): Database {
  if (!SQL) throw new Error("sql.js not initialised");
  return new SQL.Database(bytes);
}

export function exportFile(): Uint8Array {
  return requireDb().export();
}

export async function importFile(bytes: Uint8Array): Promise<void> {
  // Validate before replacing: must open and contain our tables.
  const candidate = open(bytes);
  const ok = candidate.exec(
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('dompets','members','transactions')",
  )[0]?.values[0]?.[0];
  if (ok !== 3) {
    candidate.close();
    throw new Error("Bukan file database Sedompet.");
  }
  db?.close();
  db = candidate;
  notify();
  await persist();
}

export async function resetDatabase(): Promise<void> {
  db?.close();
  db = open(null);
  notify();
  await idbPut(null);
  channel?.postMessage("changed");
}
