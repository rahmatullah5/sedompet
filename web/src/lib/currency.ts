// Multi-currency helpers.
//
// Every account has its own currency. Amounts are stored as INTEGER minor
// units of that account's currency (rupiah for IDR, cents for USD...), so
// float rounding never creeps into balances. Reports and totals convert to
// the Dompet's base currency (IDR) with the account's `fx_rate`: how many
// rupiah one whole unit of the account's currency is worth.

import { formatIDR, parseAmount } from "./format";

export const BASE_CURRENCY = "IDR";

export interface CurrencyInfo {
  code: string;
  name: string;
  flag: string;
  decimals: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "IDR", name: "Rupiah", flag: "🇮🇩", decimals: 0 },
  { code: "USD", name: "Dolar AS", flag: "🇺🇸", decimals: 2 },
  { code: "SGD", name: "Dolar Singapura", flag: "🇸🇬", decimals: 2 },
  { code: "MYR", name: "Ringgit", flag: "🇲🇾", decimals: 2 },
  { code: "EUR", name: "Euro", flag: "🇪🇺", decimals: 2 },
  { code: "GBP", name: "Pound", flag: "🇬🇧", decimals: 2 },
  { code: "AUD", name: "Dolar Australia", flag: "🇦🇺", decimals: 2 },
  { code: "JPY", name: "Yen", flag: "🇯🇵", decimals: 0 },
  { code: "KRW", name: "Won", flag: "🇰🇷", decimals: 0 },
  { code: "CNY", name: "Yuan", flag: "🇨🇳", decimals: 2 },
  { code: "HKD", name: "Dolar Hong Kong", flag: "🇭🇰", decimals: 2 },
  { code: "THB", name: "Baht", flag: "🇹🇭", decimals: 2 },
  { code: "SAR", name: "Riyal Saudi", flag: "🇸🇦", decimals: 2 },
  { code: "AED", name: "Dirham", flag: "🇦🇪", decimals: 2 },
];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: string | null | undefined): CurrencyInfo {
  return BY_CODE.get(code ?? BASE_CURRENCY) ?? { code: code ?? BASE_CURRENCY, name: code ?? "", flag: "💱", decimals: 0 };
}

export const isBase = (code: string | null | undefined) => !code || code === BASE_CURRENCY;

/** 10^decimals: minor units per whole unit. */
export function minorFactor(code: string | null | undefined) {
  return 10 ** currencyInfo(code).decimals;
}

/**
 * SQL for the rate in use on account `alias`: rupiah per 1 unit. Accounts
 * with `fx_auto` follow the live rate (market_prices, see lib/market.ts) and
 * fall back to their stored `fx_rate` while offline.
 */
export function rateSql(alias = "a") {
  return `(CASE WHEN COALESCE(${alias}.currency, 'IDR') = 'IDR' THEN 1.0
    WHEN COALESCE(${alias}.fx_auto, 1) = 1 THEN COALESCE((SELECT mp.price FROM market_prices mp WHERE mp.symbol = 'FX:' || ${alias}.currency), ${alias}.fx_rate, 1)
    ELSE COALESCE(${alias}.fx_rate, 1) END)`;
}

/**
 * SQL expression converting an amount column (minor units of `alias`'s
 * currency) to rupiah. `alias` is the accounts table alias.
 */
export function baseSql(amount: string, alias = "a") {
  const factors = CURRENCIES.filter((c) => c.decimals !== 0)
    .map((c) => `'${c.code}'`)
    .join(",");
  return `ROUND(${amount} * ${rateSql(alias)} / (CASE WHEN ${alias}.currency IN (${factors}) THEN 100 ELSE 1 END))`;
}

/**
 * SQL: market value in rupiah of the stocks held in account `alias` (live
 * price, else the average buy price). `upto` (a SQL date expression) leaves
 * out holdings added after that day.
 */
export function holdingsSql(alias = "a", upto?: string) {
  return `COALESCE((SELECT ROUND(SUM(h.shares * COALESCE((SELECT mp.price FROM market_prices mp WHERE mp.symbol = 'IDX:' || h.symbol), h.avg_price)))
    FROM holdings h WHERE h.account_id = ${alias}.id${upto ? ` AND date(h.created_at) <= ${upto}` : ""}), 0)`;
}

/** Minor units of `code` -> rupiah. */
export function toBase(amount: number, code: string | null | undefined, fxRate: number | null | undefined) {
  if (isBase(code)) return amount;
  return Math.round((amount / minorFactor(code)) * (fxRate ?? 1));
}

const formatters = new Map<string, Intl.NumberFormat>();
/** "Rp 25.000", "US$12,50", "¥1.200". */
export function formatMoney(amount: number, code: string | null | undefined = BASE_CURRENCY) {
  if (isBase(code)) return formatIDR(amount);
  const info = currencyInfo(code);
  let f = formatters.get(info.code);
  if (!f) {
    try {
      f = new Intl.NumberFormat("id-ID", { style: "currency", currency: info.code, minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals });
    } catch {
      f = new Intl.NumberFormat("id-ID", { minimumFractionDigits: info.decimals, maximumFractionDigits: info.decimals });
    }
    formatters.set(info.code, f);
  }
  return f.format(amount / minorFactor(info.code));
}

/**
 * Parses what was typed into minor units of `code`. Rupiah keeps the familiar
 * "25rb / 1,5jt / 25.000" input; other currencies accept "12.50", "12,50"
 * or "1,234.56" (the last "." or "," followed by 1-2 digits is the decimal mark).
 */
export function parseMoney(input: string, code: string | null | undefined = BASE_CURRENCY): number {
  if (isBase(code)) return parseAmount(input);
  const info = currencyInfo(code);
  const s = input.trim().replace(/\s/g, "");
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  const whole = (m ? m[1] : s).replace(/[.,]/g, "");
  const frac = m ? m[2] : "";
  if (whole === "" && frac === "") return NaN;
  const value = Number((whole || "0") + (frac ? "." + frac : ""));
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * minorFactor(info.code));
}

/** Minor units -> editable text ("12.5" for USD, "25000" for IDR). */
export function moneyInputText(amount: number, code: string | null | undefined) {
  if (isBase(code)) return String(amount);
  const f = minorFactor(code);
  return f === 1 ? String(amount) : String(amount / f);
}

const rateFmt = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** A rate in rupiah: "Rp16.250", "Rp114,21" (decimals only for small rates). */
export function formatRate(rate: number) {
  return rate >= 1000 ? formatIDR(Math.round(rate)) : rateFmt.format(rate);
}
