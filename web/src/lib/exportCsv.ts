// Spreadsheet-friendly exports (CSV, UTF-8 with BOM so Excel shows emoji and
// accents correctly). Only rows the current member can see are exported.

import { accountTypeLabel, q } from "../db/repo";
import { mq } from "../db/money";

const FLAG_LABEL: Record<string, string> = { transfer: "Transfer", adjustment: "Koreksi saldo", loan: "Pinjaman" };

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Quote when needed; neutralise formula injection (=, +, -, @ at the start of text).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function download(filename: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dompet";
}

const today = () => new Date().toISOString().slice(0, 10);

export function transactionsCsv(dompetId: string, me: string): { csv: string; count: number } {
  const txs = q.transactions(dompetId, me);
  const rows = [...txs].reverse().map((t) => [
    t.date,
    t.kind === "income" ? "Pemasukan" : "Pengeluaran",
    t.kind === "income" ? t.amount : -t.amount,
    t.account_currency,
    t.kind === "income" ? t.amount_base : -t.amount_base,
    t.parent_category_name ?? t.category_name ?? "",
    t.parent_category_name ? (t.category_name ?? "") : "",
    t.account_name,
    t.paid_by_name ?? "",
    t.note,
    t.flag ? FLAG_LABEL[t.flag] ?? t.flag : "",
    t.created_by_name ?? "",
  ]);
  return {
    count: rows.length,
    csv: toCsv(
      ["Tanggal", "Jenis", "Jumlah", "Mata uang", "Jumlah (Rp)", "Kategori", "Subkategori", "Akun", "Dibayar oleh", "Catatan", "Tipe", "Dicatat oleh"],
      rows,
    ),
  };
}

export function accountsCsv(dompetId: string, me: string): string {
  const rows = q.accounts(dompetId, me).map((a) => [
    a.name,
    accountTypeLabel(a.type),
    a.currency,
    a.balance,
    a.balance_base,
    a.visibility === "private" ? "Pribadi" : "Bersama",
    a.holder_name ?? "",
  ]);
  return toCsv(["Akun", "Jenis", "Mata uang", "Saldo", "Saldo (Rp)", "Visibilitas", "Pemegang"], rows);
}

export function loansCsv(dompetId: string, me: string): string {
  const rows = mq.loans(dompetId, me).map((l) => [
    l.direction === "lent" ? "Piutang" : "Utang",
    l.counterparty,
    l.account_currency,
    l.amount,
    Math.max(0, l.amount - l.repaid),
    l.start_date,
    l.due_date ?? "",
    l.settled ? "Lunas" : "Berjalan",
    l.note,
  ]);
  return toCsv(["Jenis", "Dengan", "Mata uang", "Jumlah", "Sisa", "Mulai", "Jatuh tempo", "Status", "Catatan"], rows);
}

export function exportTransactions(dompet: { id: string; name: string }, me: string) {
  const { csv, count } = transactionsCsv(dompet.id, me);
  download(`sedompet-${slug(dompet.name)}-transaksi-${today()}.csv`, csv, "text/csv;charset=utf-8");
  return count;
}

export function exportAccounts(dompet: { id: string; name: string }, me: string) {
  download(`sedompet-${slug(dompet.name)}-akun-${today()}.csv`, accountsCsv(dompet.id, me), "text/csv;charset=utf-8");
}

export function exportLoans(dompet: { id: string; name: string }, me: string) {
  download(`sedompet-${slug(dompet.name)}-pinjaman-${today()}.csv`, loansCsv(dompet.id, me), "text/csv;charset=utf-8");
}
