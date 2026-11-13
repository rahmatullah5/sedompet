// Sedompet service worker: makes the app open without a connection.
//
// - Page loads (/, /app, /demo): network first, cached index.html as fallback.
// - /assets/* (hashed, immutable) and icons: cache first.
// - Google Fonts: stale-while-revalidate.
// - Everything else (Supabase API, realtime, analytics) is never touched.
const VERSION = "v2";
const SHELL = `sedompet-shell-${VERSION}`;
const ASSETS = `sedompet-assets-${VERSION}`;
const FONTS = `sedompet-fonts-${VERSION}`;
const PRECACHE = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL, ASSETS, FONTS]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("sedompet-") && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(SHELL).then((c) => c.put("/", copy));
            }
            return res;
          })
          .catch(() => caches.match("/", { cacheName: SHELL }).then((r) => r || Response.error())),
      );
      return;
    }
    if (url.pathname.startsWith("/assets/") || /^\/(icon|apple-touch-icon)/.test(url.pathname)) {
      event.respondWith(
        caches.open(ASSETS).then(async (c) => {
          const hit = await c.match(req);
          if (hit) return hit;
          let res = await fetch(req);
          // Right after a deploy the browser may hold a stale 404 for a new
          // hashed file; retry once past the HTTP cache.
          if (!res.ok) res = await fetch(req, { cache: "reload" });
          if (res.ok) c.put(req, res.clone());
          return res;
        }),
      );
    }
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok || res.type === "opaque") c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      }),
    );
  }
});

// --- Push notifications (sent by the 'send-push' Edge Function) -------------
self.addEventListener("push", (event) => {
  let msg = { title: "Sedompet", body: "", url: "/app", tag: undefined };
  try {
    msg = { ...msg, ...(event.data ? event.data.json() : {}) };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: msg.tag,
      renotify: !!msg.tag,
      data: { url: msg.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/app", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const app = wins.find((w) => new URL(w.url).pathname.startsWith("/app"));
      if (app) return app.navigate(target).then((w) => (w || app).focus());
      return self.clients.openWindow(target);
    }),
  );
});
