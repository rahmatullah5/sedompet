import { cloud, type PushPrefs } from "../cloud/sync";

export const DEFAULT_PUSH_PREFS: PushPrefs = { entries: true, bills: true, budget: true, weekly: true, plan: true, reminder: true };

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** This browser's push subscription, if any. */
export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission, subscribe this browser and register it. Returns the endpoint. */
export async function enablePush(serverKey: string | null | undefined, prefs: PushPrefs) {
  if (!serverKey) throw new Error("Server belum siap untuk notifikasi. Admin perlu menyelesaikan pengaturan push.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi ditolak. Aktifkan lewat pengaturan browser untuk situs ini.");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(serverKey) }));
  await cloud.pushSubscribe(sub.toJSON(), prefs);
  return sub.endpoint;
}
