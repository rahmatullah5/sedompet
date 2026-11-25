// Live market data for Sedompet: exchange rates to rupiah and IDX stock prices.
//
//   GET /api/market?fx=USD,SGD,JPY&stocks=BBCA,TLKM&us=AAPL,VOO&crypto=BTC,ETH&gold=1
//   -> { fx: { USD: { price: 16250, time } }, stocks: { BBCA: { price, name, changePct, time } },
//        us: { AAPL: {...} (USD) }, crypto: { BTC: {...} (IDR) }, gold: { price (IDR per gram) }, missing: [] }
//
// Crypto prices come from Indodax (rupiah), falling back to Yahoo's USD pair
// times USD/IDR. Gold is the world price (COMEX, USD per troy ounce)
// converted to rupiah per gram, so it is a bit below Antam/retail prices.
//
// Browsers can't call Yahoo Finance directly (no CORS), so this edge function
// fetches it server-side. Exchange rates fall back to open.er-api.com when
// Yahoo has no quote. Responses are cached at the edge for a few minutes.

export const config = { runtime: "edge" };

interface Quote {
  price: number;
  name?: string;
  changePct?: number;
  time?: string;
}

const UA = "Mozilla/5.0 (compatible; Sedompet/1.0)";

async function yahoo(symbol: string): Promise<Quote | null> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { chart?: { result?: { meta?: Record<string, unknown> }[] } };
    const meta = j.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!meta || !Number.isFinite(price) || price <= 0) return null;
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    const changePct = Number.isFinite(Number(meta.regularMarketChangePercent))
      ? Number(meta.regularMarketChangePercent)
      : Number.isFinite(prev) && prev > 0
        ? ((price - prev) / prev) * 100
        : undefined;
    const t = Number(meta.regularMarketTime);
    return {
      price,
      name: (meta.longName as string) || (meta.shortName as string) || undefined,
      changePct,
      time: Number.isFinite(t) ? new Date(t * 1000).toISOString() : undefined,
    };
  } catch {
    return null;
  }
}

/** Rupiah per 1 unit of each currency, from open.er-api.com (daily). */
async function fallbackFx(): Promise<Record<string, number>> {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/IDR");
    if (!r.ok) return {};
    const j = (await r.json()) as { rates?: Record<string, number> };
    const out: Record<string, number> = {};
    for (const [code, perIdr] of Object.entries(j.rates ?? {})) if (perIdr > 0) out[code] = 1 / perIdr;
    return out;
  } catch {
    return {};
  }
}

/** Last trade in rupiah on Indodax, e.g. btcidr. */
async function indodax(coin: string): Promise<Quote | null> {
  try {
    const r = await fetch(`https://indodax.com/api/ticker/${coin.toLowerCase()}idr`, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const j = (await r.json()) as { ticker?: { last?: string; server_time?: number } };
    const price = Number(j.ticker?.last);
    if (!Number.isFinite(price) || price <= 0) return null;
    const t = Number(j.ticker?.server_time);
    return { price, time: Number.isFinite(t) ? new Date(t * 1000).toISOString() : undefined };
  } catch {
    return null;
  }
}

const OUNCE_GRAMS = 31.1034768;

const list = (v: string | null, re: RegExp, max: number) =>
  [...new Set((v ?? "").toUpperCase().split(",").map((s) => s.trim()).filter((s) => re.test(s)))].slice(0, max);

async function quotes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const fx = list(url.searchParams.get("fx"), /^[A-Z]{3}$/, 30).filter((c) => c !== "IDR");
  const stocks = list(url.searchParams.get("stocks"), /^[A-Z0-9]{2,6}$/, 60);
  const us = list(url.searchParams.get("us"), /^[A-Z0-9.-]{1,10}$/, 60);
  const crypto = list(url.searchParams.get("crypto"), /^[A-Z0-9]{2,10}$/, 40);
  const wantGold = url.searchParams.get("gold") === "1";
  // USD/IDR is needed to convert crypto fallbacks and gold.
  const needUsd = wantGold || crypto.length > 0;

  // Yahoo's USD pair gives a coin's name and daily change (Indodax has neither),
  // and is the price fallback when Indodax doesn't list the coin.
  const [fxQuotes, stockQuotes, usQuotes, cryptoIdr, viaUsd, usdIdr, goldUsd] = await Promise.all([
    Promise.all(fx.map((c) => yahoo(`${c}IDR=X`))),
    Promise.all(stocks.map((s) => yahoo(`${s}.JK`))),
    Promise.all(us.map((s) => yahoo(s))),
    Promise.all(crypto.map((c) => indodax(c))),
    Promise.all(crypto.map((c) => yahoo(`${c}-USD`))),
    needUsd ? yahoo("USDIDR=X") : Promise.resolve(null),
    wantGold ? yahoo("GC=F") : Promise.resolve(null),
  ]);

  const out: {
    fx: Record<string, Quote>; stocks: Record<string, Quote>; us: Record<string, Quote>; crypto: Record<string, Quote>;
    gold: Quote | null; missing: string[]; fetchedAt: string;
  } = { fx: {}, stocks: {}, us: {}, crypto: {}, gold: null, missing: [], fetchedAt: new Date().toISOString() };
  const needFallback: string[] = [];
  fx.forEach((c, i) => {
    const q = fxQuotes[i];
    if (q) out.fx[c] = { price: q.price, changePct: q.changePct, time: q.time };
    else needFallback.push(c);
  });
  if (needFallback.length) {
    const rates = await fallbackFx();
    for (const c of needFallback) {
      if (rates[c]) out.fx[c] = { price: rates[c] };
      else out.missing.push(c);
    }
  }
  stocks.forEach((s, i) => {
    const q = stockQuotes[i];
    if (q) out.stocks[s] = q;
    else out.missing.push(s);
  });
  us.forEach((s, i) => {
    const q = usQuotes[i];
    if (q) out.us[s] = q;
    else out.missing.push(`US:${s}`);
  });
  const usd = needUsd ? (usdIdr?.price ?? (await fallbackFx()).USD) : undefined;
  crypto.forEach((c, i) => {
    const idr = cryptoIdr[i];
    const u = viaUsd[i];
    if (idr) out.crypto[c] = { ...idr, name: u?.name?.replace(/ USD$/, ""), changePct: u?.changePct };
    else if (u && usd) out.crypto[c] = { price: u.price * usd, name: u.name?.replace(/ USD$/, ""), changePct: u.changePct, time: u.time };
    else out.missing.push(`CRYPTO:${c}`);
  });
  if (wantGold) {
    if (goldUsd && usd) out.gold = { price: (goldUsd.price * usd) / OUNCE_GRAMS, name: "Emas (harga dunia)", changePct: goldUsd.changePct, time: goldUsd.time };
    else out.missing.push("GOLD");
  }

  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

// ---------------------------------------------------------------------------
// CORS + rate limit
// ---------------------------------------------------------------------------
/** Sites allowed to call this from a browser: production, our preview deploys, local dev. */
function allowedOrigin(origin: string) {
  return (
    /^https:\/\/sedompet(-[a-z0-9-]+)?\.vercel\.app$/.test(origin) ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  );
}

function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin" };
  if (origin && allowedOrigin(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

/**
 * Fixed-window limit per client IP: 30 requests per minute. Kept in memory,
 * so it is per edge instance (best effort); repeat requests for the same
 * symbols are mostly answered by the CDN cache before reaching this code.
 */
const LIMIT = 30;
const WINDOW_MS = 60_000;
const hits = new Map<string, { start: number; n: number }>();

function rateLimit(ip: string, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
  const e = hits.get(ip);
  if (!e || now - e.start > WINDOW_MS) {
    hits.set(ip, { start: now, n: 1 });
    return { ok: true, left: LIMIT - 1, reset: Math.ceil(WINDOW_MS / 1000) };
  }
  e.n++;
  const reset = Math.ceil((e.start + WINDOW_MS - now) / 1000);
  return { ok: e.n <= LIMIT, left: Math.max(0, LIMIT - e.n), reset };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  // Browsers on other sites: refuse (no CORS headers either way).
  const crossSite = req.headers.get("sec-fetch-site") === "cross-site";
  if ((origin && !allowedOrigin(origin)) || (crossSite && !origin)) return json({ error: "origin_not_allowed" }, 403, cors);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405, { ...cors, Allow: "GET, OPTIONS" });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const rl = rateLimit(ip);
  const rlHeaders = { "RateLimit-Limit": String(LIMIT), "RateLimit-Remaining": String(rl.left), "RateLimit-Reset": String(rl.reset) };
  if (!rl.ok) return json({ error: "rate_limited", retryAfter: rl.reset }, 429, { ...cors, ...rlHeaders, "Retry-After": String(rl.reset) });

  const res = await quotes(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...cors, ...rlHeaders })) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
