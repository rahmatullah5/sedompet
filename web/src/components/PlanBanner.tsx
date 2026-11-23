import type { DompetSub } from "../cloud/sync";
import { WA_SUBSCRIBE } from "../lib/contact";

const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });
export const READ_ONLY_MESSAGE = "Langganan Dompet ini sudah berakhir, jadi hanya bisa dilihat. Perpanjang dulu untuk mencatat lagi.";

export function daysLeft(sub: DompetSub | undefined): number | null {
  if (!sub?.activeUntil) return null;
  return Math.ceil((new Date(sub.activeUntil).getTime() - Date.now()) / 86_400_000);
}

/** Expired: read-only notice. Ending within 7 days: reminder. Otherwise nothing. */
export function PlanBanner({ sub, isOwner }: { sub: DompetSub | undefined; isOwner: boolean }) {
  if (!sub) return null;
  const days = daysLeft(sub);
  const expired = !sub.isActive;
  if (!expired && (days === null || days > 7)) return null;
  const until = sub.activeUntil ? fmt.format(new Date(sub.activeUntil)) : null;

  return (
    <div className={`pop-in mb-4 rounded-3xl p-4 ${expired ? "bg-red-50 ring-1 ring-red-200" : "bg-sun-100 ring-1 ring-amber-200"}`} role="status">
      <p className="font-bold text-slate-800">
        {expired ? "Langganan berakhir, Dompet hanya bisa dilihat" : `Langganan berakhir ${days === 1 ? "besok" : `${days} hari lagi`}`}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        {expired
          ? `Berakhir ${until ?? ""}. Semua data tetap aman: bisa dilihat, diunduh ke Excel, dan dihapus. Untuk mencatat lagi, perpanjang langganannya.`
          : `Aktif sampai ${until}. Perpanjang sekarang supaya keluarga tetap bisa mencatat. Sisa masa aktif tidak hilang.`}
      </p>
      {isOwner ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={WA_SUBSCRIBE("tahunan")}
            target="_blank"
            rel="noopener"
            className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700"
          >
            Perpanjang Tahunan Rp99.000
          </a>
          <a href={WA_SUBSCRIBE("bulanan")} target="_blank" rel="noopener" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Bulanan Rp10.000
          </a>
        </div>
      ) : (
        <p className="mt-2 text-sm font-semibold text-slate-700">Minta pemilik Dompet untuk memperpanjang ya</p>
      )}
    </div>
  );
}
