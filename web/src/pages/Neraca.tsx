import { useState } from "react";
import { accountTypeIcon, accountTypeLabel } from "../db/repo";
import { netWorth, type NetWorthLine } from "../db/networth";
import { currentMonth, formatCompact, formatIDR, formatMonth, periodRange, shiftMonth } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { Avatar, Card, cx, Empty } from "../components/ui";
import { Icon } from "../components/Icon";
import { LineIcon } from "../components/LineIcon";

/** Net worth at the end of each of the last `n` budget months (the current one = today). */
export function netWorthTrend(dompetId: string, me: string, n = 6) {
  const now = currentMonth();
  return Array.from({ length: n }, (_, i) => {
    const month = shiftMonth(now, i - (n - 1));
    return { month, net: netWorth(dompetId, me, month === now ? null : periodRange(month).to).net };
  });
}

/** Neraca keluarga: harta, utang, kekayaan bersih, per pemilik, and its trend. */
export function Neraca() {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const nw = netWorth(dompet.id, me.id);
  const trend = netWorthTrend(dompet.id, me.id);
  const prev = trend[trend.length - 2];
  const delta = prev ? nw.net - prev.net : 0;
  const byId = new Map(members.map((m) => [m.id, m]));

  // Per owner: holder of the account (or private owner / loan account holder); null = shared.
  const owners = new Map<string | null, number>();
  for (const a of nw.assets) owners.set(a.ownerId, (owners.get(a.ownerId) ?? 0) + a.amount);
  for (const l of nw.liabilities) owners.set(l.ownerId, (owners.get(l.ownerId) ?? 0) - l.amount);
  const ownerRows = [...owners.entries()].sort((a, b) => b[1] - a[1]);
  const hasPrivate = nw.assets.some((a) => a.private) || nw.liabilities.some((l) => l.private);

  return (
    <div className="space-y-5">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Neraca</h1>
        <p className="text-sm text-slate-500">Semua yang dimiliki keluarga dikurangi semua utangnya.</p>
      </div>

      <Card className="pop-in">
        <p className="text-sm font-semibold text-slate-500">Kekayaan bersih</p>
        <p className={cx("num mt-1 text-4xl font-extrabold tracking-tight", nw.net < 0 ? "text-red-600" : "text-slate-800")}>{formatIDR(nw.net)}</p>
        <p className="mt-1 text-sm text-slate-500">sisa kekayaan kalau semua utang dilunasi hari ini</p>
        {prev && delta !== 0 && (
          <p className={cx("mt-2 text-sm font-semibold", delta > 0 ? "text-mint-600" : "text-red-600")}>
            {delta > 0 ? "+" : "−"}{formatCompact(Math.abs(delta))} dibanding akhir {formatMonth(prev.month).split(" ")[0]}
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-mint-100/60 px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">Harta</p>
            <p className="num font-extrabold text-slate-800">{formatIDR(nw.totalAssets)}</p>
          </div>
          <div className="rounded-2xl bg-red-50 px-4 py-3">
            <p className="text-xs font-semibold text-slate-500">Utang</p>
            <p className="num font-extrabold text-slate-800">{formatIDR(nw.totalLiabilities)}</p>
          </div>
        </div>
        {hasPrivate && <p className="mt-3 text-xs text-slate-400">Termasuk akun pribadimu, yang hanya terlihat olehmu.</p>}
      </Card>

      <TrendCard trend={trend} />

      {ownerRows.length > 1 && (
        <Card title="Per pemilik">
          <ul className="divide-y divide-slate-100">
            {ownerRows.map(([owner, amount]) => {
              const m = owner ? byId.get(owner) : null;
              return (
                <li key={owner ?? "shared"} className="flex items-center gap-3 py-2.5">
                  {m ? <Avatar emoji={m.emoji} colour={m.colour} size={32} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-700"><LineIcon name="users" size={18} /></span>}
                  <span className="flex-1 font-semibold text-slate-700">{m ? m.name : "Bersama"}</span>
                  <span className={cx("num font-bold", amount < 0 ? "text-red-600" : "text-slate-800")}>{formatIDR(amount)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title={`Harta · ${formatCompact(nw.totalAssets)}`}>
        {nw.assets.length === 0 ? <Empty icon="" title="Belum ada akun" /> : <Lines lines={nw.assets} byId={byId} />}
      </Card>

      <Card title={`Utang · ${formatCompact(nw.totalLiabilities)}`}>
        {nw.liabilities.length === 0 ? (
          <p className="py-2 text-center text-sm font-semibold text-mint-600">Tidak ada utang tercatat.</p>
        ) : (
          <Lines lines={nw.liabilities} byId={byId} />
        )}
      </Card>

      <p className="px-1 text-xs text-slate-400">
        Harta = saldo semua akun + piutang yang belum kembali. Utang = tagihan kartu kredit + pinjaman yang belum lunas. Saham BEI dan valas dihitung
        dengan harga/kurs terkini secara otomatis. Emas atau rumah ikut dihitung kalau dicatat sebagai akun; perbarui nilainya lewat koreksi saldo. Tabungan tujuan tanpa akun tidak dihitung, karena uangnya sudah ada di
        salah satu akun.
      </p>
    </div>
  );
}

function Lines({ lines, byId }: { lines: NetWorthLine[]; byId: Map<string, { name: string; emoji: string; colour: string }> }) {
  return (
    <ul className="divide-y divide-slate-100">
      {lines.map((l) => {
        const owner = l.ownerId ? byId.get(l.ownerId) : null;
        const isLoan = l.type === "piutang" || l.type === "utang";
        return (
          <li key={l.id} className="flex items-center gap-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <Icon value={isLoan ? "🤝" : (l.icon ?? accountTypeIcon(l.type))} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-800">
                {l.private && <LineIcon name="lock" size={13} className="mr-1 inline -mt-0.5 text-slate-400" />}
                {isLoan ? (l.type === "piutang" ? `Dipinjam ${l.name}` : `Pinjam dari ${l.name}`) : l.name}
              </span>
              <span className="block text-xs text-slate-500">
                {isLoan ? (l.type === "piutang" ? "Piutang, belum kembali" : "Utang, belum lunas") : accountTypeLabel(l.type)}
                {owner ? ` · ${owner.name}` : ""}
              </span>
            </span>
            <span className={cx("num shrink-0 font-bold", l.amount < 0 ? "text-red-600" : "text-slate-800")}>{formatIDR(l.amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Single-series bars: net worth at the end of each month. */
function TrendCard({ trend }: { trend: { month: string; net: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(0, ...trend.map((t) => t.net));
  const min = Math.min(0, ...trend.map((t) => t.net));
  const span = max - min || 1;
  const H = 140;
  const zero = (max / span) * H; // px from the top to the zero line

  return (
    <Card
      title="Perkembangan 6 bulan"
      action={
        <button className="text-sm font-semibold text-brand-700" onClick={() => setTable((v) => !v)}>
          {table ? "Lihat grafik" : "Lihat tabel"}
        </button>
      }
    >
      {table ? (
        <table className="w-full text-sm">
          <tbody>
            {trend.map((t, i) => (
              <tr key={t.month} className="border-b border-slate-100 last:border-0">
                <td className="py-1.5 capitalize text-slate-600">{i === trend.length - 1 ? "Sekarang" : `Akhir ${formatMonth(t.month)}`}</td>
                <td className="num py-1.5 text-right font-semibold text-slate-800">{formatIDR(t.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <div className="relative flex items-stretch gap-3" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            <div className="pointer-events-none absolute inset-x-0 border-t border-slate-200" style={{ top: zero }} />
            {trend.map((t, i) => {
              const h = (Math.abs(t.net) / span) * H;
              const last = i === trend.length - 1;
              return (
                <button
                  key={t.month}
                  type="button"
                  className="relative flex-1"
                  aria-label={`${last ? "Sekarang" : `Akhir ${formatMonth(t.month)}`}: ${formatIDR(t.net)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onClick={() => setHover(i)}
                >
                  <span
                    className={cx("absolute inset-x-1 transition-opacity", hover !== null && hover !== i && "opacity-50")}
                    style={{
                      top: t.net >= 0 ? zero - h : zero,
                      height: Math.max(2, h),
                      background: last ? "var(--color-brand-600)" : "var(--color-brand-500)",
                      borderRadius: t.net >= 0 ? "4px 4px 0 0" : "0 0 4px 4px",
                    }}
                  />
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-3">
            {trend.map((t, i) => (
              <span key={t.month} className="flex-1 text-center text-[11px] font-semibold capitalize text-slate-400">
                {i === trend.length - 1 ? "Kini" : formatMonth(t.month).slice(0, 3)}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-white shadow-lg"
              style={{ left: `${((hover + 0.5) / trend.length) * 100}%` }}
            >
              <p className="font-semibold capitalize text-slate-300">{hover === trend.length - 1 ? "Sekarang" : `Akhir ${formatMonth(trend[hover].month)}`}</p>
              <p className="num font-bold">{formatIDR(trend[hover].net)}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
