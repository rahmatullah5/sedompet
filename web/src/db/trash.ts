// Recycle bin ("Sampah") for deleted rows.
//
// Before a delete, the rows that will disappear (including cascaded children,
// e.g. a loan's payments) are copied as JSON into the local `trash` table.
// Restoring re-inserts them with their original ids. In cloud mode the
// re-inserts go through the normal outbox, so the server gets them back too.
//
// The trash table is not synced: it lives on the device that deleted the
// rows, and entries older than TRASH_DAYS are purged.

import { all, get, write } from "./database";
import type { SqlValue } from "sql.js";

export const TRASH_DAYS = 30;

type Run = (sql: string, params?: SqlValue[] | Record<string, SqlValue>) => void;
type Row = Record<string, SqlValue>;

/** Tables that may be restored, in foreign-key order (parents first). */
const RESTORABLE = ["loans", "recurring", "budgets", "goals", "transactions"] as const;
export type TrashTable = (typeof RESTORABLE)[number];

export interface TrashEntry {
  table: TrashTable;
  rows: Row[];
}

export interface TrashItem {
  id: string;
  dompet_id: string;
  label: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  deleted_at: string;
  count: number;
}

/** Copies rows matching `where` (e.g. "id = ?") so they can be put in the trash. */
export function snapshot(table: TrashTable, where: string, params: SqlValue[]): TrashEntry {
  return { table, rows: all<Row>(`SELECT * FROM ${table} WHERE ${where}`, params) };
}

/** Records the snapshot inside the same write that deletes the rows. */
export function putInTrash(run: Run, dompetId: string, memberId: string, label: string, entries: TrashEntry[]): string {
  const id = crypto.randomUUID();
  const kept = entries.filter((e) => e.rows.length > 0);
  run("INSERT INTO trash (id, dompet_id, label, payload, deleted_by) VALUES (?, ?, ?, ?, ?)", [
    id,
    dompetId,
    label.slice(0, 140),
    JSON.stringify(kept),
    memberId,
  ]);
  return id;
}

export const trash = {
  list(dompetId: string): TrashItem[] {
    return all<Omit<TrashItem, "count"> & { payload: string }>(
      `SELECT t.id, t.dompet_id, t.label, t.deleted_by, m.name AS deleted_by_name, t.deleted_at, t.payload
       FROM trash t LEFT JOIN members m ON m.id = t.deleted_by
       WHERE t.dompet_id = ? AND t.deleted_at >= datetime('now', ?)
       ORDER BY t.deleted_at DESC`,
      [dompetId, `-${TRASH_DAYS} days`],
    ).map(({ payload, ...item }) => ({
      ...item,
      count: (JSON.parse(payload) as TrashEntry[]).reduce((s, e) => s + e.rows.length, 0),
    }));
  },

  /** Puts the rows back. Only the person who deleted them (or an owner/admin) may restore. */
  restore(trashId: string, actor: { id: string; dompet_id: string; canManage: boolean }) {
    const item = get<{ payload: string; deleted_by: string | null; label: string }>(
      "SELECT payload, deleted_by, label FROM trash WHERE id = ? AND dompet_id = ?",
      [trashId, actor.dompet_id],
    );
    if (!item) throw new Error("Sudah tidak ada di sampah.");
    if (item.deleted_by !== actor.id && !actor.canManage) throw new Error("Hanya yang menghapus atau pemilik/admin yang bisa memulihkan.");
    const entries = (JSON.parse(item.payload) as TrashEntry[]).sort(
      (a, b) => RESTORABLE.indexOf(a.table) - RESTORABLE.indexOf(b.table),
    );
    return write((run) => {
      for (const { table, rows } of entries) {
        if (!RESTORABLE.includes(table)) continue;
        for (const row of rows) {
          const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
          try {
            run(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => row[c]));
          } catch {
            throw new Error("Tidak bisa dipulihkan: akun atau kategorinya sudah dihapus.");
          }
        }
      }
      run("DELETE FROM trash WHERE id = ?", [trashId]);
    });
  },

  /** Permanently removes one entry (or everything older than TRASH_DAYS). */
  purge(dompetId: string, trashId?: string) {
    return write((run) =>
      trashId
        ? run("DELETE FROM trash WHERE id = ? AND dompet_id = ?", [trashId, dompetId])
        : run("DELETE FROM trash WHERE deleted_at < datetime('now', ?)", [`-${TRASH_DAYS} days`]),
    );
  },
};
