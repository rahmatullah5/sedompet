import { useEffect, useState } from "react";
import { cloud } from "../cloud/sync";
import { currentPushSubscription, DEFAULT_PUSH_PREFS, enablePush, isIos, isStandalone, pushSupported } from "../lib/push";
import { LineIcon } from "./LineIcon";
import { Button, Modal, toast } from "./ui";

const KEY = "sedompet:push-prompt";
/** Ask again this long after "Nanti saja". */
const SNOOZE_MS = 4 * 60 * 60 * 1000;
/** Stop asking after this many "Nanti saja" (Menu → Notifikasi still works). */
const MAX_ASKS = 5;

type State = { next: number; asks: number };
function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (v && typeof v.next === "number" && typeof v.asks === "number") return v;
  } catch {
    /* storage blocked */
  }
  return { next: 0, asks: 0 };
}
function save(s: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

/**
 * Cloud only: asks to turn on notifications on the first login, and again a
 * few hours after "Nanti saja", while this browser has none. Stays quiet when
 * the browser can't do push, the person blocked it, or iOS needs the app
 * installed first.
 */
export function PushPrompt() {
  const [open, setOpen] = useState(false);
  const [serverKey, setServerKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported() || (isIos() && !isStandalone())) return;
    let timer: number | undefined;
    let cancelled = false;
    const check = async () => {
      const st = load();
      if (Notification.permission === "denied" || st.asks >= MAX_ASKS || Date.now() < st.next) return;
      try {
        if (await currentPushSubscription()) return;
        const key = await cloud.pushPublicKey();
        if (!key || cancelled) return;
        setServerKey(key);
        setOpen(true);
      } catch {
        /* offline: try next time */
      }
    };
    // Give the app a moment to settle after login, then re-check every 15 min
    // while it stays open (so "after a few hours" also works without a reload).
    timer = window.setTimeout(check, 3000);
    const every = window.setInterval(check, 15 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(every);
    };
  }, []);

  function later() {
    const st = load();
    save({ next: Date.now() + SNOOZE_MS, asks: st.asks + 1 });
    setOpen(false);
  }

  async function allow() {
    setBusy(true);
    try {
      await enablePush(serverKey, DEFAULT_PUSH_PREFS);
      save({ next: Number.MAX_SAFE_INTEGER, asks: 0 });
      setOpen(false);
      toast("Notifikasi aktif. Atur jenisnya di Menu → Notifikasi.");
    } catch (e) {
      // Blocked in the browser prompt: don't ask again from here.
      if (typeof Notification !== "undefined" && Notification.permission === "denied") setOpen(false);
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={later} title="Aktifkan notifikasi?">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
            <LineIcon name="bell" size={26} />
          </span>
          <div className="text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Biar nggak lupa mencatat.</p>
            <p className="mt-1">Sedompet akan mengingatkan kalau 24 jam belum ada catatan, plus tagihan jatuh tempo dan anggaran yang hampir habis.</p>
          </div>
        </div>
        <ul className="space-y-1.5 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          <li>• Bisa dimatikan kapan saja di Menu → Notifikasi.</li>
          <li>• Setelah ini browser akan minta izin. Pilih “Izinkan”.</li>
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={later} disabled={busy}>
            Nanti saja
          </Button>
          <Button onClick={allow} disabled={busy}>
            {busy ? "Mengaktifkan…" : "Aktifkan"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
