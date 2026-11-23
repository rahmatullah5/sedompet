// Live market data: exchange rates (kurs) to rupiah and IDX stock prices.
//
// Every device fetches its own copy from /api/market (a small Vercel edge
// function, see api/market.ts) into the local, non-synced `market_prices`
// table. SQL that converts money (lib/currency.ts rateSql / holdingsSql)
// reads that table, so balances, totals and reports follow the live rate
// without anything being written to the shared Dompet.

import { useEffect, useSyncExternalStore } from "react";
import { all, applyRemote, get } from "../db/database";
import { CURRENCIES } from "./currency";

export interface MarketPrice {
  symbol: string;
  price: number;
  name: string | null;
  change_pct: number | null;
  market_time: string | null;
  fetched_at: string;
}

const REFRESH_MS = 10 * 60 * 1000;

let status: { loading: boolean; error: string | null; lastFetch: number } = { loading: false, error: null, lastFetch: 0 };
const listeners = new Set<() => void>();
const setStatus = (p: Partial<typeof status>) => {
  status = { ...status, ...p };
  listeners.forEach((l) => l());
};
export const marketStore = {
  get: () => status,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
export const useMarketStatus = () => useSyncExternalStore(marketStore.subscribe, marketStore.get);

/** Rupiah per 1 unit of `code` (live), or null when never fetched. */
export function liveRate(code: string): MarketPrice | null {
  return get<MarketPrice>("SELECT * FROM market_prices WHERE symbol = ?", [`FX:${code}`]) ?? null;
}

export type PriceMarket = "IDX" | "US" | "CRYPTO" | "GOLD";

/** Last price of an asset: IDX/CRYPTO/GOLD in rupiah, US in dollars. */
export function stockPrice(symbol: string, market: PriceMarket = "IDX"): MarketPrice | null {
  return get<MarketPrice>("SELECT * FROM market_prices WHERE symbol = ?", [`${market}:${symbol.toUpperCase()}`]) ?? null;
}

/** Names for coins (Indodax prices come without one). */
const COIN_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", USDT: "Tether", BNB: "BNB", SOL: "Solana", XRP: "XRP", ADA: "Cardano",
  DOGE: "Dogecoin", TRX: "TRON", DOT: "Polkadot", LTC: "Litecoin", AVAX: "Avalanche", SHIB: "Shiba Inu", USDC: "USD Coin",
};

interface ApiQuote {
  price: number;
  name?: string;
  changePct?: number;
  time?: string;
}
interface ApiResponse {
  fx: Record<string, ApiQuote>;
  stocks: Record<string, ApiQuote>;
  us?: Record<string, ApiQuote>;
  crypto?: Record<string, ApiQuote>;
  gold?: ApiQuote | null;
  missing: string[];
  fetchedAt: string;
}

interface Wanted {
  fx?: string[];
  stocks?: string[];
  us?: string[];
  crypto?: string[];
  gold?: boolean;
}

async function fetchMarket(w: Wanted): Promise<ApiResponse> {
  const params = new URLSearchParams();
  if (w.fx?.length) params.set("fx", w.fx.join(","));
  if (w.stocks?.length) params.set("stocks", w.stocks.join(","));
  if (w.us?.length) params.set("us", w.us.join(","));
  if (w.crypto?.length) params.set("crypto", w.crypto.join(","));
  if (w.gold) params.set("gold", "1");
  const r = await fetch(`/api/market?${params}`);
  if (!r.ok) throw new Error(`Gagal ambil harga (${r.status})`);
  return (await r.json()) as ApiResponse;
}

async function store(data: ApiResponse) {
  const rows: [string, ApiQuote][] = [
    ...Object.entries(data.fx).map(([c, q]): [string, ApiQuote] => [`FX:${c}`, q]),
    ...Object.entries(data.stocks).map(([s, q]): [string, ApiQuote] => [`IDX:${s}`, q]),
    ...Object.entries(data.us ?? {}).map(([s, q]): [string, ApiQuote] => [`US:${s}`, q]),
    ...Object.entries(data.crypto ?? {}).map(([s, q]): [string, ApiQuote] => [`CRYPTO:${s}`, { ...q, name: q.name ?? COIN_NAMES[s] ?? s }]),
    ...(data.gold ? [[`GOLD:EMAS`, data.gold] as [string, ApiQuote]] : []),
  ];
  if (!rows.length) return;
  await applyRemote((run) => {
    for (const [symbol, q] of rows)
      run(
        `INSERT OR REPLACE INTO market_prices (symbol, price, name, change_pct, market_time, fetched_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [symbol, q.price, q.name ?? null, q.changePct ?? null, q.time ?? null, data.fetchedAt],
      );
  });
}

/**
 * Refreshes every rate and every held stock. Skips when fresh enough unless
 * `force`. Never throws; the error is kept in the status for the UI.
 */
export async function refreshMarket(force = false) {
  if (status.loading) return;
  if (!force && Date.now() - status.lastFetch < REFRESH_MS) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const held = all<{ market: string; symbol: string }>("SELECT DISTINCT COALESCE(market, 'IDX') AS market, symbol FROM holdings");
  const of = (m: string) => held.filter((h) => h.market === m).map((h) => h.symbol);
  const fx = CURRENCIES.map((c) => c.code).filter((c) => c !== "IDR");
  setStatus({ loading: true, error: null });
  try {
    await store(await fetchMarket({ fx, stocks: of("IDX"), us: of("US"), crypto: of("CRYPTO"), gold: of("GOLD").length > 0 }));
    setStatus({ loading: false, lastFetch: Date.now() });
  } catch (e) {
    setStatus({ loading: false, error: e instanceof Error ? e.message : String(e), lastFetch: Date.now() });
  }
}

/** Looks up one asset (for the add/buy forms). Null = not found. */
export async function lookupStock(symbol: string, market: PriceMarket = "IDX"): Promise<MarketPrice | null> {
  const s = market === "GOLD" ? "EMAS" : symbol.trim().toUpperCase();
  const re = market === "IDX" ? /^[A-Z0-9]{2,6}$/ : market === "US" ? /^[A-Z0-9.-]{1,10}$/ : /^[A-Z0-9]{2,10}$/;
  if (!re.test(s)) return null;
  const data = await fetchMarket(
    market === "IDX" ? { stocks: [s] } : market === "US" ? { us: [s], fx: ["USD"] } : market === "CRYPTO" ? { crypto: [s] } : { gold: true },
  );
  const found = market === "IDX" ? data.stocks[s] : market === "US" ? data.us?.[s] : market === "CRYPTO" ? data.crypto?.[s] : data.gold;
  if (!found) return null;
  await store(data);
  return stockPrice(s, market);
}

/** Keeps prices fresh while the app is open (on start, every 10 min, on focus). */
export function useMarketAutoRefresh() {
  useEffect(() => {
    refreshMarket();
    const id = window.setInterval(() => refreshMarket(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshMarket();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, []);
}

/** "23 Nov 14.05" for a fetched_at / market_time ISO string. */
export function priceTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
