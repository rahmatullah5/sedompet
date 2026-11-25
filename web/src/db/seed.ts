// Demo data: "Keluarga Santoso", four members with different roles, ~2 months
// of realistic Indonesian household spending. Deterministic (seeded PRNG).
//
// The demo is a rolling window: refreshDemo() regenerates the seeded entries
// from the 1st of last month up to today whenever the date changes, so the
// demo always looks current. Each day's entries come from a PRNG seeded by
// that date, so a day keeps the same entries as the window moves. Entries the
// visitor added or edited are never touched (seeded rows are recognised by
// updated_at = "<date> 12:00:00", which an edit changes).

import { all, write } from "./database";
import { insertDompet, MEMBER_COLOURS } from "./repo";
import { toISODate } from "../lib/format";

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

interface DemoIds {
  dompetId: string;
  cat: Record<string, string>;
  ayah: string;
  ibu: string;
  kakak: string;
  cashId: string;
  bca: string;
  gopay: string;
  tabungan: string;
}
type Run = (sql: string, params?: (string | number | null)[]) => void;

/** 1st of last month: the oldest day the demo shows. */
function windowStart(today = new Date()) {
  return new Date(today.getFullYear(), today.getMonth() - 1, 1);
}

/** Small stable hash of a date, to seed that day's PRNG. */
function daySeed(iso: string) {
  let h = 2166136261;
  for (const ch of iso) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Inserts the seeded household entries for every day from `from` to `to`. */
function generateDays(run: Run, ids: DemoIds, from: Date, to: Date) {
  const { dompetId, cat, ayah, ibu, kakak, cashId, bca, gopay, tabungan } = ids;
  const uid = () => crypto.randomUUID();
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const iso = toISODate(day);
    const rand = prng(daySeed(iso));
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const round = (n: number, step = 1000) => Math.max(step, Math.round(n / step) * step);
    const tx = (kind: string, amount: number, account: string, category: string, payer: string, note: string) =>
      run(
        `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid(), dompetId, account, cat[category] ?? null, kind, amount, iso, note, payer, payer, payer,
          `${iso} ${String(8 + Math.floor(rand() * 12)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`,
          `${iso} 12:00:00`,
        ],
      );
    const dom = day.getDate();

    // Monthly fixed items
    if (dom === 1) {
      tx("income", 14500000, bca, "Gaji", ayah, "Gaji bulanan");
      tx("income", 6000000, bca, "Usaha", ibu, "Hasil kue pesanan");
    }
    if (dom === 3) tx("expense", 850000, bca, "Listrik & Air", ayah, "Token PLN + PDAM");
    if (dom === 5) tx("expense", 1250000, bca, "Sekolah", ibu, "SPP Kakak & Adik");
    if (dom === 7) tx("expense", 350000, gopay, "Pulsa & Internet", ibu, "IndiHome + paket data");
    if (dom === 10) tx("expense", 500000, cashId, "Arisan", ibu, "Arisan RT");
    if (dom === 15) tx("expense", 300000, bca, "Zakat & Sedekah", ayah, "Infaq masjid");
    if (dom === 2) tx("income", 2000000, tabungan, "Bonus", ayah, "Sisihkan ke tabungan");

    // Daily-ish items
    if (rand() < 0.55) tx("expense", round(80000 + rand() * 220000), pick([gopay, cashId]), "Belanja Dapur", ibu, pick(["Pasar pagi", "Sayur & lauk", "Indomaret", "Beras 5kg + telur"]));
    if (rand() < 0.45) tx("expense", round(25000 + rand() * 90000), pick([gopay, cashId]), "Makan & Minum", pick([ayah, ibu, kakak]), pick(["Makan siang kantor", "Bakso", "Kopi susu", "Nasi padang", "Martabak"]));
    if (rand() < 0.35) tx("expense", round(15000 + rand() * 60000, 500), pick([gopay, cashId]), "Transportasi", pick([ayah, kakak]), pick(["Bensin motor", "Ojol ke kampus", "Parkir", "KRL"]));
    if (rand() < 0.12) tx("expense", round(50000 + rand() * 150000), gopay, "Hiburan", kakak, pick(["Nonton bioskop", "Langganan musik", "Main sama teman"]));
    if (rand() < 0.06) tx("expense", round(60000 + rand() * 250000), bca, "Kesehatan", ibu, pick(["Apotek", "Vitamin anak", "Dokter umum"]));
    if (rand() < 0.08) tx("expense", round(150000 + rand() * 500000), tabungan, "Lainnya", ayah, "Keperluan pribadi");
  }
}

const refreshedKey = (dompetId: string) => `sedompet.demo.day.${dompetId}`;
function markRefreshed(dompetId: string) {
  try {
    localStorage.setItem(refreshedKey(dompetId), toISODate(new Date()));
  } catch {
    /* private mode: refreshes again next load */
  }
}

/** The demo family's ids, looked up by name (works for demos seeded by older versions too). */
function findDemo(): DemoIds | null {
  const d = all<{ id: string }>("SELECT id FROM dompets WHERE name = 'Keluarga Santoso'")[0];
  if (!d) return null;
  const member = (name: string) => all<{ id: string }>("SELECT id FROM members WHERE dompet_id = ? AND name = ?", [d.id, name])[0]?.id;
  const account = (name: string) => all<{ id: string }>("SELECT id FROM accounts WHERE dompet_id = ? AND name = ?", [d.id, name])[0]?.id;
  const ids = {
    ayah: member("Ayah"),
    ibu: member("Ibu"),
    kakak: member("Kakak"),
    cashId: account("Dompet Tunai") ?? all<{ id: string }>("SELECT id FROM accounts WHERE dompet_id = ? AND type = 'cash' LIMIT 1", [d.id])[0]?.id,
    bca: account("BCA Keluarga"),
    gopay: account("GoPay Ibu"),
    tabungan: account("Tabungan Ayah"),
  };
  if (Object.values(ids).some((v) => !v)) return null;
  const cat = Object.fromEntries(all<{ id: string; name: string }>("SELECT id, name FROM categories WHERE dompet_id = ? AND parent_id IS NULL", [d.id]).map((c) => [c.name, c.id]));
  return { dompetId: d.id, cat, ...(ids as Omit<DemoIds, "dompetId" | "cat">) };
}

/**
 * Keeps the demo current: when the date has changed since the last refresh,
 * the seeded entries are regenerated for the window ending today and the
 * recent activity lines move along. Cheap no-op otherwise.
 */
export async function refreshDemo(): Promise<boolean> {
  const ids = findDemo();
  if (!ids) return false;
  const today = toISODate(new Date());
  try {
    if (localStorage.getItem(refreshedKey(ids.dompetId)) === today) return false;
  } catch {
    /* no storage: refresh every load */
  }
  await write((run) => {
    // Seeded rows only: untouched since seeding (updated_at = date 12:00:00), no flags.
    run("DELETE FROM transactions WHERE dompet_id = ? AND flag IS NULL AND updated_at = date || ' 12:00:00'", [ids.dompetId]);
    generateDays(run, ids, windowStart(), new Date());
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace("T", " ");
    run("UPDATE activity SET created_at = ? WHERE dompet_id = ? AND message LIKE 'mencatat pengeluaran Rp 186.000%'", [ago(180), ids.dompetId]);
    run("UPDATE activity SET created_at = ? WHERE dompet_id = ? AND message LIKE 'mencatat pengeluaran Rp 32.000%'", [ago(45), ids.dompetId]);
  });
  markRefreshed(ids.dompetId);
  return true;
}

export async function seedDemo(): Promise<{ dompetId: string; ownerId: string }> {
  return write((run) => {
    const { dompetId, ownerId: ayah, cashId, categoryIds: cat } = insertDompet(run, "Keluarga Santoso", "Ayah", "👨");
    const uid = () => crypto.randomUUID();

    const ibu = uid();
    const kakak = uid();
    const adik = uid();
    const addMember = (id: string, name: string, role: string, emoji: string, i: number) =>
      run("INSERT INTO members (id, dompet_id, name, role, colour, emoji) VALUES (?, ?, ?, ?, ?, ?)", [
        id, dompetId, name, role, MEMBER_COLOURS[i], emoji,
      ]);
    addMember(ibu, "Ibu", "admin", "👩", 1);
    addMember(kakak, "Kakak", "member", "🧑", 2);
    addMember(adik, "Adik", "viewer", "👧", 3);

    run("UPDATE accounts SET opening_balance = 1500000 WHERE id = ?", [cashId]);
    const bca = uid();
    const gopay = uid();
    const tabungan = uid();
    const addAccount = (id: string, name: string, type: string, opening: number, colour: string, vis = "shared", owner: string | null = null) =>
      run(
        "INSERT INTO accounts (id, dompet_id, name, type, opening_balance, colour, visibility, owner_member_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, dompetId, name, type, opening, colour, vis, owner, ayah],
      );
    addAccount(bca, "BCA Keluarga", "bank", 12000000, "#2563eb");
    addAccount(gopay, "GoPay Ibu", "ewallet", 400000, "#059669");
    addAccount(tabungan, "Tabungan Ayah", "savings", 25000000, "#7c3aed", "private", ayah);

    generateDays(run, { dompetId, cat, ayah, ibu, kakak, cashId, bca, gopay, tabungan }, windowStart(), new Date());
    markRefreshed(dompetId);

    // Budgets
    const budget = (name: string, amount: number, category: string | null, member: string | null) =>
      run("INSERT INTO budgets (id, dompet_id, name, amount, category_id, member_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        uid(), dompetId, name, amount, category ? cat[category] : null, member, ayah,
      ]);
    budget("Total bulanan", 12000000, null, null);
    budget("Belanja Dapur", 3500000, "Belanja Dapur", null);
    budget("Makan di luar", 1500000, "Makan & Minum", null);
    budget("Transportasi", 900000, "Transportasi", null);
    budget("Uang saku Kakak", 800000, null, kakak);

    // Savings goals
    const goal = (name: string, icon: string, target: number, date: string | null, account: string | null, saved: number) =>
      run("INSERT INTO goals (id, dompet_id, name, icon, target, target_date, account_id, saved, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        uid(), dompetId, name, icon, target, date, account, saved, ayah,
      ]);
    const nextYear = new Date().getFullYear() + 1;
    goal("Umroh keluarga", "🕋", 60000000, `${nextYear + 1}-06-01`, null, 14500000);
    goal("Laptop kuliah Kakak", "💻", 9000000, `${nextYear}-07-01`, null, 3200000);
    goal("Dana darurat", "🛟", 40000000, null, tabungan, 0);

    // A little history for the activity feed
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().slice(0, 19).replace("T", " ");
    const act = (member: string, message: string, min: number) =>
      run("INSERT INTO activity (id, dompet_id, member_id, message, created_at) VALUES (?, ?, ?, ?, ?)", [
        uid(), dompetId, member, message, ago(min),
      ]);
    act(ayah, 'membuat Dompet "Keluarga Santoso"', 60 * 24 * 40);
    act(ayah, "menambahkan Ibu, Kakak dan Adik sebagai anggota", 60 * 24 * 40 - 5);
    act(ayah, "membuat anggaran Total bulanan Rp 12.000.000/bulan", 60 * 24 * 39);
    act(ibu, "mencatat pengeluaran Rp 186.000 · 🛒 Belanja Dapur", 180);
    act(kakak, "mencatat pengeluaran Rp 32.000 · 🛵 Transportasi", 45);

    return { dompetId, ownerId: ayah };
  });
}
