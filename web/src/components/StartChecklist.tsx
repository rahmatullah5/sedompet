import { useState } from "react";
import { q, type Transaction } from "../db/repo";
import { all } from "../db/database";
import { can } from "../lib/permissions";
import { useCurrent } from "../lib/hooks";
import { Card, cx } from "./ui";

const key = (dompetId: string) => `sedompet.start.${dompetId}`;

/** "Mulai di sini": first steps for a new Dompet, until done or dismissed. */
export function StartChecklist({ onOpenTx }: { onOpenTx: (t: Transaction | null) => void }) {
  const { dompet, me, members } = useCurrent();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key(dompet.id)) === "hide";
    } catch {
      return false;
    }
  });
  if (hidden || !can.manage(me.role)) return null;

  const accountsSet =
    (all<{ n: number }>("SELECT count(*) AS n FROM accounts WHERE dompet_id = ? AND opening_balance <> 0", [dompet.id])[0]?.n ?? 0) > 0 ||
    (all<{ n: number }>("SELECT count(*) AS n FROM transactions WHERE dompet_id = ? AND flag = 'adjustment'", [dompet.id])[0]?.n ?? 0) > 0;
  const ownEntries =
    (all<{ n: number }>(
      "SELECT count(*) AS n FROM transactions WHERE dompet_id = ? AND flag IS NULL AND note NOT LIKE 'Berlangganan Aplikasi Sedompet%'",
      [dompet.id],
    )[0]?.n ?? 0) > 0;
  const starter = all<{ id: string }>("SELECT id FROM transactions WHERE dompet_id = ? AND note LIKE 'Berlangganan Aplikasi Sedompet%' LIMIT 1", [dompet.id])[0];
  const steps = [
    { done: accountsSet, title: "Isi saldo akun", hint: "Berapa uang di dompet & rekening sekarang? Supaya saldo di Sedompet sama dengan kenyataan.", href: "#/akun" },
    { done: ownEntries, title: "Catat pengeluaran pertamamu", hint: "Tekan ＋ di bawah. Cukup jumlah & kategori, 5 detik selesai.", action: () => onOpenTx(null) },
    { done: members.length > 1, title: "Ajak keluarga", hint: "Bagikan kode undangan lewat WhatsApp supaya semua bisa ikut mencatat.", href: "#/keluarga" },
    { done: q.budgets(dompet.id, "1970-01").length > 0, title: "Buat anggaran bulanan", hint: "Batas belanja sebulan, nanti Sedompet hitung sisa per hari.", href: "#/anggaran" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const hide = () => {
    try {
      localStorage.setItem(key(dompet.id), "hide");
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  return (
    <Card
      className="pop-in ring-2 ring-brand-200"
      title={`Mulai di sini (${doneCount}/${steps.length})`}
      action={
        <button onClick={hide} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
          Sembunyikan
        </button>
      }
    >
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const body = (
            <>
              <span
                className={cx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  s.done ? "bg-mint-600 text-white" : "bg-brand-100 text-brand-800",
                )}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className={cx("block font-semibold", s.done ? "text-slate-400 line-through" : "text-slate-800")}>{s.title}</span>
                {!s.done && <span className="block text-xs text-slate-500">{s.hint}</span>}
              </span>
              {!s.done && <span className="text-slate-400">→</span>}
            </>
          );
          return (
            <li key={s.title}>
              {s.done ? (
                <div className="flex items-center gap-3 rounded-2xl px-2 py-1.5">{body}</div>
              ) : s.href ? (
                <a href={s.href} className="flex items-center gap-3 rounded-2xl px-2 py-1.5 hover:bg-brand-50">
                  {body}
                </a>
              ) : (
                <button type="button" onClick={s.action} className="flex w-full items-center gap-3 rounded-2xl px-2 py-1.5 hover:bg-brand-50">
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {starter && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Catatan <b>“Berlangganan Aplikasi Sedompet”</b> sudah kami buat sebagai contoh, lengkap dengan pengingat perpanjangan di menu Rutin. Ubah akun
          atau hapus kalau tidak perlu.
        </p>
      )}
    </Card>
  );
}
