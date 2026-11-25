import { useEffect, useRef, useState } from "react";
import type { ScanResult } from "../lib/receiptScan";
import { formatIDR } from "../lib/format";
import { LineIcon } from "./LineIcon";
import { cx, toast } from "./ui";

type State = { step: "idle" } | { step: "scanning"; p: number; label: string; preview: string } | { step: "done"; result: ScanResult; filled: string[] };

const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });

/**
 * "Scan struk": photo of a receipt or screenshot of a payment -> OCR on the
 * phone -> fills the form. The person still checks and taps Simpan.
 */
export function ReceiptScanner({
  initialFile,
  onResult,
}: {
  /** Start scanning this file right away (from the Riwayat "Scan struk" button). */
  initialFile?: File;
  /** Apply the result to the form; returns the labels of what was filled in. */
  onResult: (r: ScanResult) => string[];
}) {
  const [state, setState] = useState<State>({ step: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function run(file: File) {
    const preview = URL.createObjectURL(file);
    setState({ step: "scanning", p: 0, label: "Menyiapkan foto…", preview });
    try {
      const { scanReceipt } = await import("../lib/receiptScan");
      const result = await scanReceipt(file, (p, label) => setState((s) => (s.step === "scanning" ? { ...s, p, label } : s)));
      const filled = onResult(result);
      setState({ step: "done", result, filled });
      if (filled.length === 0) toast("Struk kurang jelas, isi manual ya. Fotonya tetap terlampir.", "error");
    } catch (e) {
      setState({ step: "idle" });
      toast(e instanceof Error ? e.message : "Gagal membaca struk. Coba foto lebih terang dan lurus.", "error");
    } finally {
      URL.revokeObjectURL(preview);
    }
  }

  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void run(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) void run(f);
      }}
    />
  );

  if (state.step === "scanning") {
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-brand-50 p-3">
        <img src={state.preview} alt="" className="h-14 w-11 shrink-0 rounded-xl object-cover ring-2 ring-white" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-brand-800">{state.label}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.round(state.p * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-brand-700/70">Dibaca di HP-mu, fotonya tidak dikirim ke mana-mana.</p>
        </div>
      </div>
    );
  }

  if (state.step === "done") {
    const { draft, text } = state.result;
    const bits = [
      draft.amount ? formatIDR(draft.amount) : null,
      draft.merchant,
      draft.date ? dayFmt.format(new Date(draft.date + "T00:00")) : null,
    ].filter(Boolean);
    return (
      <div className={cx("rounded-3xl p-3", state.filled.length ? "bg-mint-50" : "bg-amber-50")}>
        <div className="flex items-start gap-2.5">
          <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white", state.filled.length ? "text-mint-600" : "text-amber-600")}>
            <LineIcon name={state.filled.length ? "check" : "alert"} size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-800">{state.filled.length ? "Terisi dari struk, cek dulu ya" : "Struk kurang terbaca"}</p>
            <p className="text-xs text-slate-600">{bits.length ? bits.join(" · ") : "Isi jumlah dan kategori secara manual. Fotonya sudah terlampir."}</p>
          </div>
          <button type="button" onClick={() => input.current?.click()} className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700 shadow-sm">
            Scan ulang
          </button>
        </div>
        {text.trim() && (
          <details className="mt-2 text-xs text-slate-500">
            <summary className="cursor-pointer font-semibold">Teks yang terbaca</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-white/70 p-2 font-mono text-[11px] leading-snug">{text.trim()}</pre>
          </details>
        )}
        {picker}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full items-center gap-3 rounded-3xl border-2 border-dashed border-brand-200 bg-brand-50/60 px-3 py-2.5 text-left transition hover:border-brand-500 hover:bg-brand-50 active:scale-[0.99]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-sm">
          <LineIcon name="camera" size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-brand-800">Scan struk / bukti bayar</span>
          <span className="block text-xs text-slate-500">Foto struk atau screenshot GoPay, OVO, m-banking. Terisi otomatis.</span>
        </span>
      </button>
      {picker}
    </>
  );
}
