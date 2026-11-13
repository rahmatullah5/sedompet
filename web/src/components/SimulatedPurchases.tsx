import { useEffect, useState } from "react";

// Landing-page "recent purchase" popup. Every entry is randomly generated and
// is always shown with a visible "Simulasi" label, so visitors are never told
// that a made-up purchase really happened. Swap the generator for real
// (masked, consented) purchases once payments are recorded.

const NAMES = ["Rahmat", "Siti", "Budi", "Dewi", "Andi", "Rina", "Fajar", "Nur", "Agus", "Lestari", "Yusuf", "Putri", "Hendra", "Maya", "Rizky", "Ayu"];
const GROUPS = ["& keluarga", "& keluarga", "& keluarga", "& teman kos", "& rombongan trip"];
const CITIES = ["Jakarta", "Bandung", "Surabaya", "Medan", "Makassar", "Yogyakarta", "Semarang", "Bekasi", "Depok", "Malang", "Palembang", "Denpasar"];
const PREFIXES = ["0812", "0813", "0821", "0852", "0857", "0878", "0896", "0838"];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

interface Entry {
  name: string;
  group: string;
  city: string;
  phone: string;
  plan: "Tahunan" | "Bulanan";
  ago: string;
}

function randomEntry(): Entry {
  const minutes = 1 + Math.floor(Math.random() * 58);
  return {
    name: pick(NAMES),
    group: pick(GROUPS),
    city: pick(CITIES),
    phone: `${pick(PREFIXES)}••••${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`,
    // Yearly is the plan we want to highlight; roughly 2 in 3.
    plan: Math.random() < 0.65 ? "Tahunan" : "Bulanan",
    ago: minutes < 2 ? "baru saja" : `${minutes} menit lalu`,
  };
}

const DISMISS_KEY = "sedompet-sim-dismissed";

export function SimulatedPurchases() {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    let timer: number;
    const show = () => {
      setEntry(randomEntry());
      setVisible(true);
      timer = window.setTimeout(hide, 5500);
    };
    const hide = () => {
      setVisible(false);
      timer = window.setTimeout(show, 15000 + Math.random() * 10000);
    };
    timer = window.setTimeout(show, 6000);
    return () => window.clearTimeout(timer);
  }, [dismissed]);

  if (dismissed || !entry) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 left-4 right-4 z-30 transition-all duration-500 sm:right-auto sm:w-[22rem] motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
      }`}
    >
      <div className="flex items-start gap-3 rounded-3xl bg-white p-3.5 pr-2 shadow-[0_18px_40px_-14px_rgba(120,72,40,0.45)] ring-1 ring-slate-100">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-2xl">🛒</span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="text-slate-700">
            <b className="text-slate-800">
              {entry.name} {entry.group}
            </b>{" "}
            <span className="text-slate-500">({entry.phone})</span> ambil paket <b className="text-brand-700">{entry.plan}</b>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
            <span className="rounded-full bg-slate-100 px-1.5 py-px font-bold uppercase tracking-wide text-slate-500">Payment</span>
            {entry.city} · {entry.ago}
          </p>
        </div>
        <button
          type="button"
          aria-label="Tutup notifikasi"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* private mode */
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
