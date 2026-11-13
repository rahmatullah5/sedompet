import { useState } from "react";
import { recapText, weeklyRecap } from "../db/recap";
import { formatCompact, formatIDR } from "../lib/format";
import { useCurrent } from "../lib/hooks";
import { Card, cx, toast } from "./ui";

/** "Rekap minggu ini / lalu" on Beranda, with sharing to WhatsApp. */
export function RecapCard({ budgetLine }: { budgetLine?: string }) {
  const { dompet } = useCurrent();
  // Early in the week the finished week is the more useful recap.
  const [offset, setOffset] = useState(() => (new Date().getDay() === 1 ? -1 : 0));
  const r = weeklyRecap(dompet.id, offset);
  const text = recapText(r, dompet.name, { budgetLine });
  const max = Math.max(1, ...r.categories.map((c) => c.total));

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        /* cancelled or unsupported: fall back to WhatsApp link */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Rekap disalin. Tempel di grup WhatsApp 📋");
    } catch {
      toast("Tidak bisa menyalin di browser ini", "error");
    }
  };

  return (
    <Card
      className="pop-in"
      title="Rekap mingguan 📊"
      action={
        <div className="grid grid-cols-2 gap-0.5 rounded-full bg-slate-100 p-0.5 text-[11px] font-bold">
          {(
            [
              [0, "Minggu ini"],
              [-1, "Minggu lalu"],
            ] as const
          ).map(([o, l]) => (
            <button key={o} type="button" aria-pressed={offset === o} onClick={() => setOffset(o)} className={cx("rounded-full px-2.5 py-1", offset === o ? "bg-slate-800 text-white" : "text-slate-500")}>
              {l}
            </button>
          ))}
        </div>
      }
    >
      <p className="text-xs text-slate-500">
        {r.week.label}
        {r.inProgress ? " · sampai hari ini" : ""} · akun bersama
      </p>
      <div className="mt-1 flex flex-wrap items-end gap-x-3">
        <span className="num text-2xl font-extrabold text-slate-800">{formatIDR(r.spent)}</span>
        {r.change !== null && (
          <span className={cx("pb-1 text-sm font-semibold", r.change > 0 ? "text-red-600" : "text-mint-600")}>
            {r.change > 0 ? "▲" : r.change < 0 ? "▼" : "="} {Math.abs(r.change)}% vs minggu sebelumnya
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500">keluar dari {r.entries} catatan{r.income > 0 ? ` · masuk ${formatCompact(r.income)}` : ""}</p>

      {r.categories.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {r.categories.map((c) => (
            <li key={c.name} className="text-sm">
              <div className="flex justify-between">
                <span className="text-slate-700">
                  {c.icon} {c.name}
                </span>
                <span className="num font-semibold text-slate-800">{formatCompact(c.total)}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full" style={{ width: `${(c.total / max) * 100}%`, background: "var(--color-brand-500)" }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Belum ada pengeluaran dari akun bersama minggu {offset === 0 ? "ini" : "lalu"}.</p>
      )}
      {r.biggest && r.biggest.total > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          🔝 Terbesar: <b className="text-slate-700">{r.biggest.note || r.biggest.category || "Tanpa catatan"}</b> · {formatCompact(r.biggest.total)}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={share} className="flex items-center gap-1.5 rounded-full bg-[#128C7E] px-4 py-2 text-sm font-bold text-white hover:bg-[#0f7a6e]">
          💬 Bagikan ke WhatsApp
        </button>
        <button type="button" onClick={copy} className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          Salin teks
        </button>
      </div>
    </Card>
  );
}
