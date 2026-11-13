import { useEffect, useState } from "react";
import { Button } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Pasang di HP": native install prompt on Android/desktop Chrome, instructions on iOS. */
export function InstallCard() {
  const [, force] = useState(0);
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (standalone() || (!deferred && !isIos())) return null;

  return (
    <div className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
      <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-slate-800">Pasang Sedompet di HP</p>
        <p className="text-xs text-slate-500">
          {iosHelp ? "Di Safari: ketuk tombol Bagikan ⬆️, lalu pilih “Tambah ke Layar Utama”." : "Buka seperti aplikasi, tetap bisa dibuka tanpa sinyal."}
        </p>
      </div>
      {!iosHelp && (
        <Button
          onClick={async () => {
            if (deferred) {
              await deferred.prompt();
              await deferred.userChoice;
              deferred = null;
              force((n) => n + 1);
            } else setIosHelp(true);
          }}
        >
          Pasang
        </Button>
      )}
    </div>
  );
}
