import { useEffect, useState } from "react";
import { getMode } from "../cloud/client";
import { cloud, type PushPrefs } from "../cloud/sync";
import { Button, Card, cx, Empty, toast } from "../components/ui";

const DEFAULT_PREFS: PushPrefs = { entries: true, bills: true, budget: true, weekly: true, plan: true };

const ITEMS: { key: keyof PushPrefs; icon: string; title: string; hint: string }[] = [
  { key: "entries", icon: "✍️", title: "Catatan anggota lain", hint: "“Ibu mencatat pengeluaran · Pasar · Rp 85.000”" },
  { key: "bills", icon: "🔁", title: "Tagihan & utang jatuh tempo", hint: "Sehari sebelum dan di hari jatuh tempo, jam 7 pagi" },
  { key: "budget", icon: "🐷", title: "Anggaran total bulanan", hint: "Saat terpakai 80% dan saat terlewati" },
  { key: "weekly", icon: "📊", title: "Rekap mingguan", hint: "Senin pagi: belanja minggu lalu" },
  { key: "plan", icon: "⏳", title: "Masa langganan", hint: "7 hari, 1 hari sebelum, dan saat berakhir" },
];

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Notifikasi: turn web push on/off for this device and choose what to get. */
export function Notifications() {
  const cloudMode = getMode() === "cloud";
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloudMode || !supported()) return setReady(true);
    (async () => {
      try {
        setServerKey(await cloud.pushPublicKey());
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          setEndpoint(sub.endpoint);
          setPrefs({ ...DEFAULT_PREFS, ...((await cloud.pushPrefs(sub.endpoint)) ?? {}) });
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setReady(true);
      }
    })();
  }, [cloudMode]);

  async function enable() {
    setBusy(true);
    try {
      if (!serverKey) throw new Error("Server belum siap untuk notifikasi. Admin perlu menyelesaikan pengaturan push.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan lewat pengaturan browser untuk situs ini.");
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(serverKey) }));
      await cloud.pushSubscribe(sub.toJSON(), prefs);
      setEndpoint(sub.endpoint);
      toast("Notifikasi aktif di perangkat ini 🔔");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await cloud.pushUnsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setEndpoint(null);
      toast("Notifikasi dimatikan di perangkat ini");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: keyof PushPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    if (endpoint) {
      try {
        await cloud.pushSetPrefs(endpoint, next);
      } catch (e) {
        setPrefs(prefs);
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    }
  }

  let blocker: string | null = null;
  if (!cloudMode) blocker = "Notifikasi hanya untuk akun online. Demo berjalan di browser saja, jadi tidak bisa menerima pesan.";
  else if (isIos() && !standalone()) blocker = "Di iPhone/iPad, pasang Sedompet dulu: di Safari ketuk Bagikan ⬆️ → “Tambah ke Layar Utama”, lalu buka dari ikonnya.";
  else if (!supported()) blocker = "Browser ini belum mendukung notifikasi web. Coba Chrome, Edge, Firefox, atau Safari terbaru.";
  else if (ready && serverKey === null) blocker = "Server belum siap untuk notifikasi. Admin perlu menyelesaikan pengaturan push (lihat SETUP-PUSH.md).";

  return (
    <div className="space-y-5">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Notifikasi 🔔</h1>
        <p className="text-sm text-slate-500">Pengingat di HP, walau Sedompet sedang tidak dibuka.</p>
      </div>

      <Card>
        {blocker ? (
          <Empty icon="🔕" title="Belum bisa di sini">
            {blocker}
          </Empty>
        ) : !ready ? (
          <p className="py-4 text-center text-sm text-slate-400">Memeriksa…</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-bold text-slate-800">{endpoint ? "Aktif di perangkat ini" : "Belum aktif di perangkat ini"}</p>
              <p className="text-xs text-slate-500">Atur di setiap HP/laptop yang kamu pakai.</p>
            </div>
            {endpoint ? (
              <Button variant="secondary" disabled={busy} onClick={disable}>
                Matikan
              </Button>
            ) : (
              <Button disabled={busy} onClick={enable}>
                {busy ? "Mengaktifkan…" : "Aktifkan notifikasi"}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card title="Kabari aku tentang">
        <ul className="divide-y divide-slate-100">
          {ITEMS.map((it) => (
            <li key={it.key}>
              <label className={cx("flex cursor-pointer items-center gap-3 py-3", !!blocker && "opacity-50")}>
                <span className="text-2xl">{it.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-800">{it.title}</span>
                  <span className="block text-xs text-slate-500">{it.hint}</span>
                </span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--color-brand-600)]"
                  checked={prefs[it.key]}
                  disabled={!!blocker}
                  onChange={() => toggle(it.key)}
                />
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">Catatan dari akun pribadi tidak pernah dikirim ke anggota lain.</p>
      </Card>
    </div>
  );
}
