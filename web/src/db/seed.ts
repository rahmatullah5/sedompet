// Demo data: "Keluarga Santoso", four members with different roles, ~2 months
// of realistic Indonesian household spending. Deterministic (seeded PRNG).

import { write } from "./database";
import { insertDompet, MEMBER_COLOURS } from "./repo";
import { toISODate } from "../lib/format";

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
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

    const rand = prng(42);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const round = (n: number, to = 1000) => Math.max(to, Math.round(n / to) * to);

    const tx = (date: Date, kind: string, amount: number, account: string, category: string, payer: string, note: string) =>
      run(
        `INSERT INTO transactions (id, dompet_id, account_id, category_id, kind, amount, date, note, paid_by, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uid(), dompetId, account, cat[category], kind, amount, toISODate(date), note, payer, payer, payer,
          `${toISODate(date)} ${String(8 + Math.floor(rand() * 12)).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`,
          `${toISODate(date)} 12:00:00`,
        ],
      );

    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const day = new Date(d);
      const dom = day.getDate();

      // Monthly fixed items
      if (dom === 1) {
        tx(day, "income", 14500000, bca, "Gaji", ayah, "Gaji bulanan");
        tx(day, "income", 6000000, bca, "Usaha", ibu, "Hasil kue pesanan");
      }
      if (dom === 3) tx(day, "expense", 850000, bca, "Listrik & Air", ayah, "Token PLN + PDAM");
      if (dom === 5) tx(day, "expense", 1250000, bca, "Sekolah", ibu, "SPP Kakak & Adik");
      if (dom === 7) tx(day, "expense", 350000, gopay, "Pulsa & Internet", ibu, "IndiHome + paket data");
      if (dom === 10) tx(day, "expense", 500000, cashId, "Arisan", ibu, "Arisan RT");
      if (dom === 15) tx(day, "expense", 300000, bca, "Zakat & Sedekah", ayah, "Infaq masjid");
      if (dom === 2) tx(day, "income", 2000000, tabungan, "Bonus", ayah, "Sisihkan ke tabungan");

      // Daily-ish items
      if (rand() < 0.55) tx(day, "expense", round(80000 + rand() * 220000), pick([gopay, cashId]), "Belanja Dapur", ibu, pick(["Pasar pagi", "Sayur & lauk", "Indomaret", "Beras 5kg + telur"]));
      if (rand() < 0.45) tx(day, "expense", round(25000 + rand() * 90000), pick([gopay, cashId]), "Makan & Minum", pick([ayah, ibu, kakak]), pick(["Makan siang kantor", "Bakso", "Kopi susu", "Nasi padang", "Martabak"]));
      if (rand() < 0.35) tx(day, "expense", round(15000 + rand() * 60000, 500), pick([gopay, cashId]), "Transportasi", pick([ayah, kakak]), pick(["Bensin motor", "Ojol ke kampus", "Parkir", "KRL"]));
      if (rand() < 0.12) tx(day, "expense", round(50000 + rand() * 150000), gopay, "Hiburan", kakak, pick(["Nonton bioskop", "Langganan musik", "Main sama teman"]));
      if (rand() < 0.06) tx(day, "expense", round(60000 + rand() * 250000), bca, "Kesehatan", ibu, pick(["Apotek", "Vitamin anak", "Dokter umum"]));
      if (rand() < 0.08) tx(day, "expense", round(150000 + rand() * 500000), tabungan, "Lainnya", ayah, "Keperluan pribadi");
    }

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
