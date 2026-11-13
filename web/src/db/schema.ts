// SQLite schema for the Sedompet web demo.
//
// Every finance table carries `dompet_id` so one browser can hold several
// Dompets (Family, Kos Bareng, Trip Bali...). The same shape is what phase 2
// will sync to Postgres, so `created_by` / `paid_by` are already here.
//
// Money is stored as INTEGER minor units of the account's currency (rupiah
// for IDR) to avoid float rounding; see lib/currency.ts.

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = /* sql */ `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS dompets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  currency    TEXT NOT NULL DEFAULT 'IDR',
  period_start_day INTEGER NOT NULL DEFAULT 1,  -- budget month starts on this day (payday), 1-28
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  dompet_id   TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  colour      TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🙂',
  user_id     TEXT,                       -- Supabase auth user (cloud mode); NULL = not joined yet
  phone       TEXT,                       -- set for members added by phone
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS members_dompet ON members(dompet_id);

CREATE TABLE IF NOT EXISTS accounts (
  id               TEXT PRIMARY KEY,
  dompet_id        TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  -- Built-in key (cash, bank, ewallet, savings, credit, investment) or a
  -- custom group name typed by the family ("Kartu kredit", "Emas"...).
  type             TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 30),
  opening_balance  INTEGER NOT NULL DEFAULT 0,  -- minor units of \`currency\`
  currency         TEXT NOT NULL DEFAULT 'IDR',
  fx_rate          REAL NOT NULL DEFAULT 1,     -- rupiah per 1 unit of \`currency\`
  colour           TEXT NOT NULL,
  icon             TEXT,                  -- emoji or data: URL image; NULL = by type
  -- 'private' accounts (and their transactions) are only visible to owner_member_id
  visibility       TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared','private')),
  owner_member_id  TEXT REFERENCES members(id) ON DELETE SET NULL,
  holder_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,  -- whose account it is
  archived         INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS accounts_dompet ON accounts(dompet_id);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  dompet_id   TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  icon        TEXT NOT NULL,
  colour      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('expense','income')),
  parent_id   TEXT REFERENCES categories(id) ON DELETE CASCADE,  -- subcategory
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS categories_dompet ON categories(dompet_id);

-- 'lent' = someone owes us (piutang), 'borrowed' = we owe (utang)
CREATE TABLE IF NOT EXISTS loans (
  id            TEXT PRIMARY KEY,
  dompet_id     TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
  counterparty  TEXT NOT NULL CHECK (length(counterparty) BETWEEN 1 AND 60),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  start_date    TEXT NOT NULL,
  due_date      TEXT,
  note          TEXT NOT NULL DEFAULT '',
  settled       INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS loans_dompet ON loans(dompet_id);

-- Subscriptions/bills (expense) and salary etc (income)
CREATE TABLE IF NOT EXISTS recurring (
  id            TEXT PRIMARY KEY,
  dompet_id     TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  icon          TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  paid_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
  frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  every         INTEGER NOT NULL DEFAULT 1 CHECK (every BETWEEN 1 AND 12),
  next_date     TEXT NOT NULL,
  end_date      TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS recurring_dompet ON recurring(dompet_id, next_date);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  dompet_id    TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id  TEXT REFERENCES categories(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('expense','income')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  date         TEXT NOT NULL,              -- YYYY-MM-DD (local)
  note         TEXT NOT NULL DEFAULT '',
  -- 'transfer' / 'adjustment' move balances but are left out of spending stats
  flag         TEXT CHECK (flag IN ('transfer','adjustment','loan')),
  loan_id      TEXT REFERENCES loans(id) ON DELETE CASCADE,
  recurring_id TEXT REFERENCES recurring(id) ON DELETE SET NULL,
  transfer_id  TEXT,                      -- links both sides of a transfer (+ its fee)
  split_with   TEXT,                      -- JSON [{"m": member id, "a": share}] for shared/split expenses
  need         TEXT CHECK (need IS NULL OR need IN ('need','want')),  -- kebutuhan / keinginan
  merchant     TEXT,                      -- tempat beli
  receipt      TEXT,                      -- receipt photo: data: URL (demo) or storage path (cloud)
  paid_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tx_dompet_date ON transactions(dompet_id, date);

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  dompet_id    TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  category_id  TEXT REFERENCES categories(id) ON DELETE CASCADE,  -- NULL = all expenses
  category_ids TEXT,                                              -- JSON array, when it covers several categories
  member_id    TEXT REFERENCES members(id) ON DELETE CASCADE,     -- NULL = whole family (else allowance)
  exclude_category_ids TEXT,                                      -- JSON array, for "all except" budgets
  period       TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly')),
  created_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS budgets_dompet ON budgets(dompet_id);

-- Savings goals. Progress = linked account's balance, else \`saved\` (rupiah).
CREATE TABLE IF NOT EXISTS goals (
  id           TEXT PRIMARY KEY,
  dompet_id    TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  icon         TEXT NOT NULL DEFAULT '🎯',
  target       INTEGER NOT NULL CHECK (target > 0),
  target_date  TEXT,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  saved        INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS goals_dompet ON goals(dompet_id);

CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY,
  dompet_id   TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  member_id   TEXT REFERENCES members(id) ON DELETE SET NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_dompet ON activity(dompet_id, created_at);

-- Local recycle bin (not synced): JSON copies of deleted rows, see db/trash.ts.
CREATE TABLE IF NOT EXISTS trash (
  id          TEXT PRIMARY KEY,
  dompet_id   TEXT NOT NULL,
  label       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  deleted_by  TEXT,
  deleted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS trash_dompet ON trash(dompet_id, deleted_at);
`;

/** Columns added after v1, applied to databases created by older versions. */
export const COLUMN_UPGRADES: [table: string, column: string, definition: string][] = [
  ["members", "user_id", "TEXT"],
  ["dompets", "period_start_day", "INTEGER NOT NULL DEFAULT 1"],
  ["accounts", "icon", "TEXT"],
  ["accounts", "currency", "TEXT NOT NULL DEFAULT 'IDR'"],
  ["accounts", "fx_rate", "REAL NOT NULL DEFAULT 1"],
  ["accounts", "holder_member_id", "TEXT REFERENCES members(id) ON DELETE SET NULL"],
  ["members", "phone", "TEXT"],
  ["categories", "parent_id", "TEXT REFERENCES categories(id) ON DELETE CASCADE"],
  ["budgets", "exclude_category_ids", "TEXT"],
  ["budgets", "category_ids", "TEXT"],
  ["budgets", "period", "TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly'))"],
  ["transactions", "flag", "TEXT CHECK (flag IN ('transfer','adjustment','loan'))"],
  ["transactions", "loan_id", "TEXT REFERENCES loans(id) ON DELETE CASCADE"],
  ["transactions", "recurring_id", "TEXT REFERENCES recurring(id) ON DELETE SET NULL"],
  ["transactions", "transfer_id", "TEXT"],
  ["transactions", "split_with", "TEXT"],
  ["transactions", "need", "TEXT CHECK (need IS NULL OR need IN ('need','want'))"],
  ["transactions", "merchant", "TEXT"],
  ["transactions", "receipt", "TEXT"],
];
