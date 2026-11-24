// Landing hero: a phone that plays a short, looping walk-through of the app.
// Ibu taps ＋, types an amount, picks a category and saves; the family total
// drops and her note joins the feed; Ayah's note arrives as a notification;
// then Laporan shows where the month went. Runs only while on screen, and
// shows the end state without motion under prefers-reduced-motion.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, cx } from "./ui";
import { LineIcon } from "./LineIcon";

type TapTarget = "fab" | "chip" | "save" | "report" | "home";

interface Note {
  id: string;
  who: string;
  emoji: string;
  colour: string;
  text: string;
  mine?: boolean;
}

interface State {
  screen: "home" | "report";
  sheet: boolean;
  amount: string;
  chip: boolean;
  tap: { at: TapTarget; n: number } | null;
  feed: Note[];
  balance: number;
  left: number;
  notif: Note | null;
  toast: boolean;
}

const KAKAK: Note = { id: "kakak", who: "Kakak", emoji: "🧑", colour: "#4f8ef7", text: "membayar SPP Rp 750.000" };
const AYAH_PAGI: Note = { id: "ayah1", who: "Ayah", emoji: "👨", colour: "#f47c5a", text: "mencatat parkir Rp 10.000" };
const KAMU: Note = { id: "kamu", who: "Kamu", emoji: "👩", colour: "#e5689b", text: "mencatat belanja dapur Rp 186.000", mine: true };
const AYAH: Note = { id: "ayah2", who: "Ayah", emoji: "👨", colour: "#f47c5a", text: "mencatat bensin Rp 50.000" };

const START: State = {
  screen: "home",
  sheet: false,
  amount: "",
  chip: false,
  tap: null,
  feed: [KAKAK, AYAH_PAGI],
  balance: 12_480_000,
  left: 4_136_000,
  notif: null,
  toast: false,
};

const END: State = { ...START, feed: [AYAH, KAMU, KAKAK], balance: 12_244_000, left: 3_900_000 };

const BUDGET = 6_000_000;
const TYPED = ["1", "18", "186", "1.860", "18.600", "186.000"];

// [time in ms, change]
type Step = [number, (s: State) => Partial<State>];
let taps = 0;
const tap = (at: TapTarget) => ({ tap: { at, n: ++taps } });
const SCRIPT: Step[] = [
  [1400, () => tap("fab")],
  [1700, () => ({ sheet: true })],
  ...TYPED.map((amount, i): Step => [2300 + i * 190, () => ({ amount })]),
  [3700, () => ({ ...tap("chip"), chip: true })],
  [4400, () => tap("save")],
  [4700, (s) => ({ sheet: false, toast: true, feed: [KAMU, ...s.feed].slice(0, 3), balance: 12_294_000, left: 3_950_000 })],
  [6000, () => ({ toast: false })],
  [6400, () => ({ notif: AYAH })],
  [7700, (s) => ({ notif: null, feed: [AYAH, ...s.feed].slice(0, 3), balance: 12_244_000, left: 3_900_000 })],
  [9000, () => tap("report")],
  [9300, () => ({ screen: "report" })],
  [13600, () => tap("home")],
  [13900, () => START],
];
const LOOP = 14600;

function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setOn(true);
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function PhoneDemo() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const [still] = useState(reducedMotion);
  const [s, setS] = useState<State>(still ? END : START);

  useEffect(() => {
    if (still || !onScreen) return;
    let timers: number[] = [];
    const run = () => {
      setS(START);
      timers = SCRIPT.map(([t, f]) => window.setTimeout(() => setS((p) => ({ ...p, ...f(p) })), t));
      timers.push(window.setTimeout(run, LOOP));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [onScreen, still]);

  const spent = 8_100_000 + START.balance - s.balance;
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Contoh Sedompet: Ibu mencatat belanja dapur, saldo keluarga langsung berkurang, catatan Ayah masuk, lalu laporan pengeluaran bulan ini."
      className="relative mx-auto w-[300px] rounded-[2.5rem] border-[10px] border-slate-800 bg-slate-800 shadow-[0_30px_60px_-20px_rgba(120,72,40,0.45)]"
    >
      <div aria-hidden className="relative h-[540px] overflow-hidden rounded-[1.9rem] bg-[#fff8f1] text-left">
        {/* Home */}
        <div className={cx("absolute inset-0 p-4 transition duration-300", s.screen === "home" ? "opacity-100" : "pointer-events-none -translate-x-6 opacity-0")}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-800">Selamat pagi, Ibu</span>
            <Avatar emoji="👩" colour="#e5689b" size={28} />
          </div>
          <div className="rounded-3xl bg-brand-600 p-4 text-white">
            <p className="text-[11px] text-brand-100">Uang keluarga sekarang</p>
            <p className="num text-2xl font-extrabold">
              <CountTo value={s.balance} />
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <span className="rounded-xl bg-white/15 px-2 py-1.5">
                Masuk <b className="block text-sm">+20,5 jt</b>
              </span>
              <span className="rounded-xl bg-white/15 px-2 py-1.5">
                Keluar <b className="block text-sm">−{(spent / 1e6).toFixed(1).replace(".", ",")} jt</b>
              </span>
            </div>
          </div>
          <div className="mt-3 rounded-2xl bg-white p-3 text-[12px] shadow-sm">
            <p>
              <b>Masih aman!</b> Sisa <CountTo value={s.left} short />, kira-kira Rp 260 rb per hari.
            </p>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-[#2fb67c] transition-[width] duration-700 ease-out" style={{ width: `${(s.left / BUDGET) * 100}%` }} />
            </div>
          </div>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">Baru saja</p>
          <div className="mt-1.5 space-y-2 text-[12px]">
            {s.feed.map((n) => (
              <div key={n.id} className={cx("pop-in flex items-end gap-2", n.mine && "flex-row-reverse")}>
                <Avatar emoji={n.emoji} colour={n.colour} size={24} />
                <p className={cx("rounded-2xl px-3 py-1.5", n.mine ? "rounded-br-md bg-brand-100 text-brand-800" : "rounded-bl-md bg-slate-100")}>
                  <b>{n.who}</b> {n.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Laporan */}
        <div className={cx("absolute inset-0 p-4 transition duration-300", s.screen === "report" ? "opacity-100" : "pointer-events-none translate-x-6 opacity-0")}>
          <p className="text-lg font-extrabold text-slate-800">Laporan</p>
          <p className="text-[11px] text-slate-500">Ke mana uang keluarga pergi bulan ini</p>
          <div className="mt-3 rounded-2xl bg-white p-3 shadow-sm">
            <p className="text-[11px] font-bold text-slate-500">Pengeluaran November</p>
            <p className="num text-xl font-extrabold text-slate-800">Rp {(spent / 1e6).toFixed(1).replace(".", ",")} jt</p>
            <div className="mt-3 space-y-2.5 text-[11px]">
              {[
                ["Dapur & belanja", 38, "#f47c5a"],
                ["Pendidikan", 26, "#6d5bd0"],
                ["Transportasi", 14, "#fbc93d"],
                ["Tagihan rumah", 12, "#4fc492"],
                ["Lainnya", 10, "#b29d8b"],
              ].map(([label, pct, colour], i) => (
                <div key={label as string}>
                  <div className="flex justify-between text-slate-600">
                    <span>{label}</span>
                    <b>{pct}%</b>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: s.screen === "report" ? `${(pct as number) * 2.4}%` : "0%", background: colour as string, transitionDelay: `${150 + i * 110}ms` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-2xl bg-mint-50 p-3 text-[12px] text-mint-700">
            <b>Perkiraan akhir bulan:</b> masih sisa sekitar Rp 1,2 jt.
          </div>
        </div>

        {/* Notification from another phone */}
        <div className={cx("absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-2xl bg-white/95 p-2.5 text-[11px] shadow-lg ring-1 ring-slate-100 transition duration-500", s.notif ? "translate-y-0 opacity-100" : "-translate-y-24 opacity-0")}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <LineIcon name="wallet" size={15} />
          </span>
          <span className="min-w-0">
            <b className="block text-slate-800">Sedompet · baru saja</b>
            <span className="text-slate-600">
              <b>{AYAH.who}</b> {AYAH.text}
            </span>
          </span>
        </div>

        {/* Saved toast */}
        <div className={cx("absolute inset-x-0 bottom-20 z-10 flex justify-center transition duration-300", s.toast ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0")}>
          <span className="rounded-full bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white">Tersimpan, keluarga sudah lihat</span>
        </div>

        {/* Bottom bar */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-slate-100 bg-white px-6 pb-3 pt-2 text-[10px] font-semibold">
          <Tab active={s.screen === "home"} icon="home" label="Beranda" tapped={s.tap?.at === "home" ? s.tap.n : 0} />
          <span className="relative -mt-7 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/40">
            <LineIcon name="plus" size={24} />
            <Ripple n={s.tap?.at === "fab" ? s.tap.n : 0} />
          </span>
          <Tab active={s.screen === "report"} icon="bars" label="Laporan" tapped={s.tap?.at === "report" ? s.tap.n : 0} />
        </div>

        {/* Add sheet */}
        <div className={cx("absolute inset-0 z-30 bg-slate-900/30 transition-opacity duration-300", s.sheet ? "opacity-100" : "pointer-events-none opacity-0")} />
        <div className={cx("absolute inset-x-0 bottom-0 z-40 rounded-t-3xl bg-white p-4 shadow-2xl transition-transform duration-300 ease-out", s.sheet ? "translate-y-0" : "translate-y-full")}>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
          <p className="text-[11px] font-bold text-slate-500">Pengeluaran baru</p>
          <p className="num mt-1 text-3xl font-extrabold text-slate-800">
            Rp {s.amount || <span className="text-slate-300">0</span>}
            <span className="ml-0.5 inline-block h-7 w-0.5 translate-y-1 animate-pulse bg-brand-600" />
          </p>
          <p className="mt-3 text-[11px] font-bold text-slate-500">Kategori</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
            <span className={cx("relative overflow-hidden rounded-full px-3 py-1.5 transition-colors", s.chip ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}>
              Dapur
              <Ripple n={s.tap?.at === "chip" ? s.tap.n : 0} />
            </span>
            {["Bensin", "Jajan", "Tagihan", "Sekolah"].map((c) => (
              <span key={c} className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
                {c}
              </span>
            ))}
          </div>
          <span className="relative mt-4 block overflow-hidden rounded-full bg-brand-600 py-2.5 text-center text-sm font-bold text-white">
            Simpan
            <Ripple n={s.tap?.at === "save" ? s.tap.n : 0} />
          </span>
        </div>
      </div>
    </div>
  );
}

function Tab({ active, icon, label, tapped }: { active: boolean; icon: "home" | "bars"; label: string; tapped: number }) {
  return (
    <span className={cx("relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1 transition-colors", active ? "text-brand-700" : "text-slate-400")}>
      <LineIcon name={icon} size={20} />
      {label}
      <Ripple n={tapped} />
    </span>
  );
}

/** A finger tap: a soft circle that grows and fades. Re-plays for each new n. */
function Ripple({ n }: { n: number }): ReactNode {
  if (!n) return null;
  return <span key={n} className="pd-tap pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 rounded-full bg-slate-900/25" />;
}

/** Tweens a rupiah amount to its new value. */
function CountTo({ value, short }: { value: number; short?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = Math.round(start + (value - start) * (1 - (1 - k) ** 3));
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (short) return <>Rp {(shown / 1e6).toFixed(2).replace(".", ",")} jt</>;
  return <>Rp {shown.toLocaleString("id-ID")}</>;
}
