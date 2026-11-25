import { useEffect, useState, useSyncExternalStore } from "react";
import { finishTour, tourStore } from "../lib/tour";
import { LineIcon, type LineIconName } from "./LineIcon";
import { cx } from "./ui";

type Step = {
  /** data-tour value of the element to highlight; none = centred card. */
  target?: string;
  /** Page (hash) the target lives on. */
  page?: string;
  icon?: LineIconName;
  title: string;
  body: string;
};

function steps(canAdd: boolean): Step[] {
  return [
    {
      icon: "wallet",
      title: "Selamat datang di Sedompet",
      body: "Satu dompet untuk seluruh keluarga: semua bisa mencatat, semua tahu sisa uang. Kita keliling sebentar, kurang dari 1 menit.",
    },
    {
      target: "balance",
      page: "beranda",
      title: "Uang keluarga sekarang",
      body: "Total saldo akun bersama, plus pemasukan dan pengeluaran bulan ini. Ketuk ikon mata untuk menyembunyikan angka saat di tempat umum.",
    },
    ...(canAdd
      ? [
          {
            target: "add",
            page: "beranda",
            title: "Tombol paling penting",
            body: "Setiap kali belanja, ketuk ＋. Isi jumlah dan pilih kategori, selesai dalam 5 detik. Pemasukan dan transfer antar-akun juga dari sini.",
          },
        ]
      : []),
    {
      target: "riwayat",
      page: "beranda",
      title: "Riwayat",
      body: "Semua catatan keluarga per hari. Cari, saring, atau ketuk satu catatan untuk mengubahnya.",
    },
    {
      target: "laporan",
      page: "beranda",
      title: "Laporan",
      body: "Ke mana uang pergi bulan ini: per kategori, per orang, dan tren bulanan. Widget-nya bisa diatur sendiri.",
    },
    {
      target: "menu",
      page: "beranda",
      title: "Menu",
      body: "Semua fitur lain ada di sini. Ini yang paling sering dipakai:",
    },
    {
      target: "m-anggaran",
      page: "menu",
      title: "Anggaran",
      body: "Pasang batas belanja harian, mingguan, atau bulanan. Sisa yang tidak terpakai bisa terbawa ke periode berikutnya.",
    },
    {
      target: "m-akun",
      page: "menu",
      title: "Isi dompet",
      body: "Daftarkan tunai, rekening bank, dan e-wallet beserta saldonya, supaya angka di Sedompet sama dengan kenyataan.",
    },
    {
      target: "m-keluarga",
      page: "menu",
      title: "Keluarga",
      body: "Ajak pasangan dan anak lewat kode undangan WhatsApp. Atur siapa yang boleh mencatat atau hanya melihat.",
    },
    {
      target: "m-notifikasi",
      page: "menu",
      title: "Notifikasi",
      body: "Pengingat kalau seharian belum mencatat, tagihan jatuh tempo, dan anggaran yang hampir habis.",
    },
    {
      target: "dompet",
      page: "beranda",
      title: "Ganti Dompet",
      body: "Punya keuangan terpisah, misalnya kos bareng atau trip? Buat Dompet lain dan pindah dari sini.",
    },
    {
      icon: "check",
      title: "Siap!",
      body: canAdd
        ? "Mulai dengan mencatat satu pengeluaran hari ini. Tutorial ini bisa dibuka lagi dari Menu."
        : "Tutorial ini bisa dibuka lagi dari Menu.",
    },
  ];
}

const PAD = 8;
const GAP = 14;
const DIM = "rgba(28, 20, 16, 0.62)";

/** Rect of the visible element with this data-tour value. */
function findRect(target: string) {
  const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed");
  return el ? { el, rect: el.getBoundingClientRect() } : null;
}

/**
 * First-use coach marks: dims the app, spotlights one real control at a time
 * with a short explanation. Shown once (see lib/tour.ts), replay from Menu.
 */
export function Tour({ canAdd, onAddFirst }: { canAdd: boolean; onAddFirst: () => void }) {
  const { running } = useSyncExternalStore(tourStore.subscribe, tourStore.get);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const list = steps(canAdd);
  const step = list[Math.min(i, list.length - 1)];
  const last = i >= list.length - 1;

  const [, setViewport] = useState(0);
  useEffect(() => {
    if (running) setI(0);
    if (!running) return;
    const onResize = () => setViewport((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [running]);

  // Go to the step's page, scroll its target into view, then follow it.
  useEffect(() => {
    if (!running) return;
    setRect(null);
    if (!step.target) return;
    if (step.page && location.hash.replace(/^#\/?/, "") !== step.page) location.hash = `/${step.page}`;
    let raf = 0;
    let scrolled = false;
    const t0 = performance.now();
    const loop = () => {
      const hit = findRect(step.target!);
      if (hit) {
        if (!scrolled) {
          scrolled = true;
          if (getComputedStyle(hit.el).position !== "fixed" && !hit.el.closest("nav")) hit.el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        setRect((prev) => {
          const r = hit.rect;
          return prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r;
        });
      } else if (performance.now() - t0 > 2500) {
        // Target missing (e.g. role hides it): skip this step.
        setI((n) => n + 1);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, i, step.target, step.page]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!running) return null;

  function end() {
    finishTour();
    if (location.hash.replace(/^#\/?/, "") !== "beranda") location.hash = "/beranda";
    window.scrollTo({ top: 0 });
  }
  function next() {
    if (last) end();
    else setI((n) => n + 1);
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(340, vw - 32);
  const centred = !step.target || !rect;
  const below = rect ? rect.bottom + GAP + 220 < vh || rect.top < vh / 2 : false;
  const left = rect ? Math.max(16, Math.min(vw - width - 16, rect.left + rect.width / 2 - width / 2)) : (vw - width) / 2;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Tutorial Sedompet">
      {/* Blocks taps on the app; the spotlight's huge shadow does the dimming. */}
      <div className="absolute inset-0" style={{ background: centred ? DIM : "transparent" }} />
      {rect && step.target && (
        <div
          className="pointer-events-none absolute rounded-3xl ring-2 ring-white/90 transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: `0 0 0 9999px ${DIM}`,
          }}
        />
      )}
      {(centred ? !step.target : true) && (
        <div
          key={i}
          className="pop-in absolute rounded-3xl bg-white p-5 text-slate-800 shadow-2xl"
          style={
            centred
              ? { width, left, top: "50%", transform: "translateY(-50%)" }
              : below
                ? { width, left, top: rect!.bottom + PAD + GAP }
                : { width, left, bottom: vh - rect!.top + PAD + GAP }
          }
        >
          {step.icon && (
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <LineIcon name={step.icon} size={26} />
            </span>
          )}
          <p className="text-lg font-extrabold tracking-tight">{step.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.body}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className={cx("flex gap-1", last && "hidden")} aria-label={`Langkah ${i + 1} dari ${list.length}`}>
              {list.map((_, n) => (
                <span key={n} className={cx("h-1.5 rounded-full transition-all", n === i ? "w-4 bg-brand-600" : "w-1.5 bg-slate-200")} />
              ))}
            </div>
            <div className={cx("flex shrink-0 items-center gap-1", last && "ml-auto")}>
              {!last && (
                <button onClick={end} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-400 hover:text-slate-600">
                  Lewati
                </button>
              )}
              {last && canAdd ? (
                <>
                  <button onClick={end} className="rounded-full px-3 py-2 text-sm font-semibold text-slate-500 hover:text-slate-700">
                    Nanti
                  </button>
                  <button
                    onClick={() => {
                      end();
                      onAddFirst();
                    }}
                    className="rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
                  >
                    Catat sekarang
                  </button>
                </>
              ) : (
                <button onClick={next} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  {last ? "Selesai" : i === 0 ? "Mulai" : "Lanjut"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
