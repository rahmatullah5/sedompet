// SQLite schema for the Sedompet web demo.
//
// Every finance table carries `dompet_id` so one browser can hold several
// Dompets (Family, Kos Bareng, Trip Bali...). The same shape is what phase 2
// will sync to Postgres, so `created_by` / `paid_by` are already here.
//
// Money is stored as INTEGER rupiah (no decimals) to avoid float rounding.

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
  type             TEXT NOT NULL CHECK (type IN ('cash','bank','ewallet','savings')),
  opening_balance  INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS activity (
  id          TEXT PRIMARY KEY,
  dompet_id   TEXT NOT NULL REFERENCES dompets(id) ON DELETE CASCADE,
  member_id   TEXT REFERENCES members(id) ON DELETE SET NULL,
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_dompet ON activity(dompet_id, created_at);
`;

/** Columns added after v1, applied to databases created by older versions. */
export const COLUMN_UPGRADES: [table: string, column: string, definition: string][] = [
  ["members", "user_id", "TEXT"],
  ["accounts", "icon", "TEXT"],
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
];
