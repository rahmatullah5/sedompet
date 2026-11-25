import { useEffect, useState } from "react";
import { getMode } from "../cloud/client";
import { cloud, type PushPrefs } from "../cloud/sync";
import { Button, Card, cx, toast } from "../components/ui";
import { LineIcon, type LineIconName } from "../components/LineIcon";
import { DEFAULT_PUSH_PREFS, enablePush, isIos, isStandalone, pushSupported } from "../lib/push";


const ITEMS: { key: keyof PushPrefs; icon: LineIconName; title: string; hint: string }[] = [
  { key: "reminder", icon: "bell", title: "Pengingat mencatat", hint: "Kalau 24 jam belum ada catatan darimu (jam 7 pagi–10 malam)" },
  { key: "entries", icon: "adjust", title: "Catatan anggota lain", hint: "“Ibu mencatat pengeluaran · Pasar · Rp 85.000”" },
  { key: "bills", icon: "repeat", title: "Tagihan & utang jatuh tempo", hint: "Sehari sebelum dan di hari jatuh tempo, jam 7 pagi" },
  { key: "budget", icon: "piggy", title: "Anggaran total bulanan", hint: "Saat terpakai 80% dan saat terlewati" },
  { key: "weekly", icon: "bars", title: "Rekap mingguan", hint: "Senin pagi: belanja minggu lalu" },
  { key: "plan", icon: "clock", title: "Masa langganan", hint: "7 hari, 1 hari sebelum, dan saat berakhir" },
];

/** Notifikasi: turn web push on/off for this device and choose what to get. */
export function Notifications() {
  const cloudMode = getMode() === "cloud";
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [ready, setReady] = useState(false);
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloudMode || !pushSupported()) return setReady(true);
    (async () => {
      try {
        setServerKey(await cloud.pushPublicKey());
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          setEndpoint(sub.endpoint);
          setPrefs({ ...DEFAULT_PUSH_PREFS, ...((await cloud.pushPrefs(sub.endpoint)) ?? {}) });
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
      setEndpoint(await enablePush(serverKey, prefs));
      toast("Notifikasi aktif di perangkat ini");
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
  else if (isIos() && !isStandalone()) blocker = "Di iPhone/iPad, pasang Sedompet dulu: di Safari ketuk Bagikan → “Tambah ke Layar Utama”, lalu buka dari ikonnya.";
  else if (!pushSupported()) blocker = "Browser ini belum mendukung notifikasi web. Coba Chrome, Edge, Firefox, atau Safari terbaru.";
  else if (ready && serverKey === null) blocker = "Server belum siap untuk notifikasi. Admin perlu menyelesaikan pengaturan push (lihat SETUP-PUSH.md).";

  return (
    <div className="space-y-5">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Notifikasi</h1>
        <p className="text-sm text-slate-500">Pengingat di HP, walau Sedompet sedang tidak dibuka.</p>
      </div>

      <Card>
        {blocker ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="text-slate-500">
              <LineIcon name="bell" size={40} />
            </span>
            <p className="font-bold">Belum bisa di sini</p>
            <div className="text-sm text-slate-500">{blocker}</div>
          </div>
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
                <span className="shrink-0 text-slate-500">
                  <LineIcon name={it.icon} size={22} />
                </span>
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
