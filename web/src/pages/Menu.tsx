import { q } from "../db/repo";
import { MadeBy } from "../components/ui";
import { mq } from "../db/money";
import { formatCompact } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { DataTools } from "./Members";
import { useSyncExternalStore } from "react";
import { cloudStore } from "../cloud/sync";
import { WA_FEEDBACK } from "../lib/contact";

const ITEMS = [
  { href: "#/anggaran", icon: "🐷", title: "Anggaran", hint: "Batas belanja & uang saku" },
  { href: "#/rutin", icon: "🔁", title: "Rutin", hint: "Langganan, SPP, gaji" },
  { href: "#/pinjaman", icon: "🤝", title: "Utang & Piutang", hint: "Pinjam-meminjam" },
  { href: "#/akun", icon: "💳", title: "Isi dompet", hint: "Tunai, bank, e-wallet" },
  { href: "#/kategori", icon: "🏷️", title: "Kategori", hint: "Kategori & subkategori" },
  { href: "#/keluarga", icon: "👨‍👩‍👧", title: "Keluarga", hint: "Anggota & peran" },
];

export function Menu() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const due = mq.due(dompet.id, me.id).length;
  const openLoans = mq.loans(dompet.id, me.id).filter((l) => !l.settled).length;
  const accounts = q.accounts(dompet.id, me.id).length;
  const badge: Record<string, string | null> = {
    "#/rutin": due ? `${due} jatuh tempo` : null,
    "#/pinjaman": openLoans ? `${openLoans} berjalan` : null,
    "#/akun": `${accounts} akun`,
  };
  const balance = q.accounts(dompet.id, me.id).reduce((s, a) => s + a.balance_base, 0);
  const { appAdmin } = useSyncExternalStore(cloudStore.subscribe, cloudStore.get);
  const items = appAdmin ? [...ITEMS, { href: "#/admin", icon: "🛡️", title: "Admin", hint: "Kode aktivasi & nomor" }] : ITEMS;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Menu</h1>
        <p className="text-sm text-slate-500">
          {dompet.name} · saldo {formatCompact(balance)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className="rounded-3xl bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)] transition hover:-translate-y-0.5"
          >
            <span className="text-3xl">{it.icon}</span>
            <p className="mt-2 font-bold text-slate-800">{it.title}</p>
            <p className="text-xs text-slate-500">{it.hint}</p>
            {badge[it.href] && <p className="mt-1.5 text-xs font-semibold text-brand-700">{badge[it.href]}</p>}
          </a>
        ))}
      </div>
      <a
        href={WA_FEEDBACK}
        target="_blank"
        rel="noopener"
        className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)] transition hover:-translate-y-0.5"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#25D366]/15 text-2xl">💬</span>
        <span className="flex-1">
          <span className="block font-bold text-slate-800">Kirim masukan</span>
          <span className="block text-xs text-slate-500">Saran, kendala, atau ide? Chat admin lewat WhatsApp.</span>
        </span>
        <span className="text-slate-400">→</span>
      </a>
      <DataTools />
      <MadeBy className="pb-2 text-center" />
    </div>
  );
}
