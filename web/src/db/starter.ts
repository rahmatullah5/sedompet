// Starter data for someone's first Dompet, so a new user sees how an entry,
// a category and a Rutin reminder look instead of an empty app.
//
//   * category "Langganan & Aplikasi"
//   * expense "Berlangganan Aplikasi" (what they paid for Sedompet)
//   * Rutin reminder to renew on the day their plan ends
// Written as normal local rows, so in cloud mode they sync like any entry.

import { get, write } from "./database";
import { todayISO } from "../lib/format";

export type StarterPlan = "bulanan" | "tahunan" | "gratis" | "anggota" | null;

const uid = () => crypto.randomUUID();

function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  const t = new Date(y, m - 1 + months, Math.min(d, last));
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/**
 * Adds the starter rows to a fresh Dompet. `plan` / `activeUntil` come from the
 * owner's subscription; unknown plans are treated as Tahunan. Free plans get
 * no payment entry (they didn't pay), only the category.
 */
export async function addStarterData(dompetId: string, ownerId: string, plan: StarterPlan, activeUntil: string | null) {
  const account = get<{ id: string }>(
    "SELECT id FROM accounts WHERE dompet_id = ? AND visibility = 'shared' AND archived = 0 ORDER BY created_at LIMIT 1",
    [dompetId],
  );
  if (!account) return;
  const paid = plan !== "gratis" && plan !== "anggota";
  const monthly = plan === "bulanan";
  const amount = monthly ? 10_000 : 99_000;
  const today = todayISO();
  const renewOn = activeUntil ? activeUntil.slice(0, 10) : addMonths(today, monthly ? 1 : 12);

  await write((run) => {
    const categoryId = uid();
    run("INSERT INTO categories (id, dompet_id, name, icon, colour, kind, sort_order) VALUES (?, ?, ?, ?, ?, 'expense', ?)", [
      categoryId, dompetId, "Langganan & Aplikasi", "📱", "#0ea5e9", 9,
    ]);
    if (!paid) return;
    run(
      `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'expense', ?, ?, ?, ?, ?, ?)`,
      [uid(), dompetId, account.id, categoryId, amount, today, `Berlangganan Aplikasi Sedompet (${monthly ? "Bulanan" : "Tahunan"})`, ownerId, ownerId, ownerId],
    );
    run(
      `INSERT INTO recurring (id, dompet_id, name, icon, kind, amount, account_id, category_id, paid_by, frequency, every, next_date, created_by)
       VALUES (?, ?, ?, '📱', 'expense', ?, ?, ?, ?, ?, 1, ?, ?)`,
      [uid(), dompetId, "Perpanjang Sedompet", amount, account.id, categoryId, ownerId, monthly ? "monthly" : "yearly", renewOn, ownerId],
    );
    run("INSERT INTO activity (id, dompet_id, member_id, message) VALUES (?, ?, ?, ?)", [
      uid(), dompetId, ownerId, "mulai pakai Sedompet 🎉 (catatan langganan pertama sudah dibuat sebagai contoh)",
    ]);
  });
}
