import { useEffect, useState } from "react";
import { LOT, m, MARKETS, q, unitsText, type Account, type Holding, type Market } from "../db/repo";
import { can } from "../lib/permissions";
import { formatCompact, formatIDR, parseAmount, todayISO } from "../lib/format";
import { formatMoney, formatRate } from "../lib/currency";
import { liveRate, lookupStock, priceTime, refreshMarket, stockPrice, useMarketStatus } from "../lib/market";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Button, cx, Field, Input, Select, STICKY_ACTIONS } from "./ui";
import { DatePicker } from "./DatePicker";
import { ChangePct, LineIcon } from "./LineIcon";

const ORDER: Market[] = ["IDX", "US", "CRYPTO", "GOLD"];

/** Rupiah per 1 unit of a market's price currency (USD for US stocks). */
const usdRate = () => liveRate("USD")?.price ?? 1;
const toIdr = (market: Market, amount: number) => (MARKETS[market].currency === "USD" ? amount * usdRate() : amount);

/** Market value of a holding in rupiah (live price, else average buy price). */
export const holdingValue = (h: Holding) => Math.round(toIdr(h.market, h.shares * (h.price ?? h.avg_price)));
const holdingCost = (h: Holding) => Math.round(toIdr(h.market, h.shares * h.avg_price));

/** A price in its market's currency: "US$342,56", "Rp5.700", "Rp1.131.286.000". */
export function formatPrice(market: Market, price: number) {
  return MARKETS[market].currency === "USD" ? formatMoney(Math.round(price * 100), "USD") : formatRate(price);
}

/** "12,5" / "0.0125" -> number (decimal comma or dot). */
function parseUnits(text: string) {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return NaN;
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}
/** Price typed in the market's currency (rupiah keeps "25rb"-style input). */
const parsePrice = (market: Market, text: string) => (MARKETS[market].currency === "USD" ? parseUnits(text) : parseAmount(text));

const label = (h: Holding) => (h.market === "GOLD" ? "Emas" : h.symbol);

/** Compact list of holdings shown under an account row. */
export function HoldingLines({ holdings }: { holdings: Holding[] }) {
  if (!holdings.length) return null;
  return (
    <ul className="space-y-0.5">
      {holdings.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">{label(h)}</span>
            <span className="truncate text-slate-500">{unitsText(h.market, h.shares)}</span>
            <ChangePct value={h.change_pct} />
          </span>
          <span className="num font-semibold text-slate-700">{formatIDR(holdingValue(h))}</span>
        </li>
      ))}
    </ul>
  );
}

type Mode = { kind: "list" } | { kind: "trade"; side: "buy" | "sell"; holding?: Holding } | { kind: "set"; holding?: Holding };

/** The "Investasi" sheet of an account: stocks, ETFs, crypto and gold with live prices. */
export function StockPanel({ account: initial, onClose }: { account: Account; onClose: () => void }) {
  useDbVersion();
  const { dompet, me } = useCurrent();
  // Fresh balance after every buy/sell.
  const account = q.accounts(dompet.id, me.id).find((a) => a.id === initial.id) ?? initial;
  const market = useMarketStatus();
  const holdings = q.holdings(dompet.id, me.id, account.id);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const allowed = can.addTransaction(me.role);
  const value = holdings.reduce((s, h) => s + holdingValue(h), 0);
  const gain = value - holdings.reduce((s, h) => s + holdingCost(h), 0);
  const fetchedAt = holdings.map((h) => h.price_at).filter(Boolean).sort().pop();

  if (mode.kind === "trade")
    return <TradeForm account={account} side={mode.side} holding={mode.holding} holdings={holdings} onDone={() => setMode({ kind: "list" })} />;
  if (mode.kind === "set") return <SetHoldingForm account={account} holding={mode.holding} onDone={() => setMode({ kind: "list" })} />;

  const groups = ORDER.map((mk) => ({ mk, items: holdings.filter((h) => h.market === mk) })).filter((g) => g.items.length);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">Kas</p>
          <p className="num text-sm font-bold text-slate-800">{formatMoney(account.balance, account.currency).replace(/,00$/, "")}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">Nilai investasi</p>
          <p className="num text-sm font-bold text-slate-800">{formatCompact(value)}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">Untung/rugi</p>
          <p className={cx("num text-sm font-bold", gain >= 0 ? "text-mint-600" : "text-red-600")}>
            {gain >= 0 ? "+" : "−"}
            {formatCompact(Math.abs(gain))}
          </p>
        </div>
      </div>

      {groups.length ? (
        groups.map(({ mk, items }) => (
          <div key={mk}>
            {groups.length > 1 && <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{MARKETS[mk].label}</p>}
            <ul className="divide-y divide-slate-100">
              {items.map((h) => {
                const v = holdingValue(h);
                const g = v - holdingCost(h);
                const pct = h.avg_price > 0 && h.price ? ((h.price - h.avg_price) / h.avg_price) * 100 : null;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      disabled={!allowed}
                      onClick={() => setMode({ kind: "set", holding: h })}
                      className="flex w-full items-center gap-3 rounded-2xl px-1 py-2.5 text-left enabled:hover:bg-slate-50"
                    >
                      <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-700">{label(h)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-800">{h.market === "GOLD" ? "Emas" : (h.name ?? h.symbol)}</span>
                        <span className="block text-xs text-slate-500">
                          {unitsText(h.market, h.shares)} · rata² {formatPrice(h.market, h.avg_price)}
                        </span>
                        <span className="flex gap-2 text-xs text-slate-500">
                          {h.price ? <>harga {formatPrice(h.market, h.price)}</> : <span className="text-amber-700">harga belum ada</span>}
                          <ChangePct value={h.change_pct} />
                        </span>
                      </span>
                      <span className="flex flex-col items-end">
                        <span className="num text-sm font-bold text-slate-800">{formatIDR(v)}</span>
                        <span className={cx("num text-xs font-semibold", g >= 0 ? "text-mint-600" : "text-red-600")}>
                          {g >= 0 ? "+" : "−"}
                          {formatCompact(Math.abs(g))}
                          {pct != null && ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")}%)`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      ) : (
        <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Belum ada investasi. Catat yang sudah dimiliki (saham BEI, saham/ETF AS, kripto, emas), atau catat pembelian baru.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          {market.loading
            ? "Mengambil harga…"
            : market.error
              ? `Gagal update: ${market.error}`
              : fetchedAt
                ? `Harga per ${priceTime(fetchedAt)}. Saham bisa tertunda ±15 menit; emas = harga dunia.`
                : ""}
        </span>
        <button type="button" className="inline-flex shrink-0 items-center gap-1 font-semibold text-brand-700" onClick={() => refreshMarket(true)} disabled={market.loading}>
          <LineIcon name="refresh" size={13} />
          Perbarui
        </button>
      </div>

      <div className={`${STICKY_ACTIONS} justify-between`}>
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
        {allowed && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setMode({ kind: "set" })}>
              <LineIcon name="plus" size={14} />
              Sudah punya
            </Button>
            {holdings.length > 0 && (
              <Button variant="secondary" onClick={() => setMode({ kind: "trade", side: "sell" })}>
                Jual
              </Button>
            )}
            <Button onClick={() => setMode({ kind: "trade", side: "buy" })}>Beli</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function MarketSelect({ value, onChange, disabled }: { value: Market; onChange: (m: Market) => void; disabled?: boolean }) {
  return (
    <Field label="Jenis">
      <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Market)}>
        {ORDER.map((mk) => (
          <option key={mk} value={mk}>
            {MARKETS[mk].label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Ticker field that looks the code up and reports name + price. */
function useTicker(market: Market, initial: string) {
  const [symbol, setSymbol] = useState(initial);
  const [info, setInfo] = useState<{ name: string | null; price: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const clean = market === "GOLD" ? "EMAS" : symbol.trim().toUpperCase();
  useEffect(() => {
    setNotFound(false);
    const ok = market === "GOLD" || (market === "IDX" ? /^[A-Z0-9]{4}$/ : market === "US" ? /^[A-Z0-9.-]{1,10}$/ : /^[A-Z0-9]{2,10}$/).test(clean);
    if (!ok) {
      setInfo(null);
      return;
    }
    const cached = stockPrice(clean, market);
    setInfo(cached ? { name: cached.name, price: cached.price } : null);
    let live = true;
    setChecking(true);
    const t = window.setTimeout(async () => {
      try {
        const p = await lookupStock(clean, market);
        if (!live) return;
        if (p) setInfo({ name: p.name, price: p.price });
        else if (!cached) setNotFound(true);
      } catch {
        /* offline: keep what we have */
      } finally {
        if (live) setChecking(false);
      }
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [clean, market]);
  return { symbol, setSymbol, clean, info, checking, notFound };
}

const HINT: Record<Market, string> = { IDX: "4 huruf, mis. BBCA, TLKM", US: "mis. AAPL, NVDA, VOO, QQQ", CRYPTO: "mis. BTC, ETH, SOL", GOLD: "" };
const PLACEHOLDER: Record<Market, string> = { IDX: "BBCA", US: "AAPL", CRYPTO: "BTC", GOLD: "" };

function TickerField({ t, market, disabled }: { t: ReturnType<typeof useTicker>; market: Market; disabled?: boolean }) {
  if (market === "GOLD")
    return (
      <p className="rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
        Emas dihitung per gram dengan harga emas dunia{t.info ? <> · sekarang <b className="num">{formatIDR(Math.round(t.info.price))}</b>/gram</> : t.checking ? " · mengambil harga…" : ""}.
        <span className="block text-xs text-slate-400">Harga Antam/toko biasanya sedikit lebih tinggi.</span>
      </p>
    );
  return (
    <Field
      label={market === "CRYPTO" ? "Kode koin" : "Kode saham / ETF"}
      hint={t.checking && !t.info ? "Mencari…" : t.notFound ? "Kode tidak ditemukan" : t.info ? `${t.info.name ?? t.clean} · ${formatPrice(market, t.info.price)}` : HINT[market]}
    >
      <Input
        value={t.symbol}
        disabled={disabled}
        maxLength={10}
        autoCapitalize="characters"
        placeholder={PLACEHOLDER[market]}
        onChange={(e) => t.setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9.-]/g, ""))}
        className="uppercase"
      />
    </Field>
  );
}

const unitLabel = (market: Market) => (market === "IDX" ? "Jumlah lot" : market === "GOLD" ? "Berat (gram)" : market === "CRYPTO" ? "Jumlah koin" : "Jumlah lembar");
const priceLabel = (market: Market) =>
  market === "GOLD" ? "Harga per gram (Rp)" : market === "CRYPTO" ? "Harga per koin (Rp)" : market === "US" ? "Harga per lembar (US$)" : "Harga per lembar";

function TradeForm({ account, side: initialSide, holding, holdings, onDone }: { account: Account; side: "buy" | "sell"; holding?: Holding; holdings: Holding[]; onDone: () => void }) {
  const { me } = useCurrent();
  const [side, setSide] = useState(initialSide);
  const first = holding ?? (initialSide === "sell" ? holdings[0] : undefined);
  const [market, setMarket] = useState<Market>(first?.market ?? "IDX");
  const t = useTicker(market, first?.symbol ?? "");
  const [unitsTextIn, setUnitsText] = useState(market === "IDX" ? "1" : "");
  const [priceText, setPriceText] = useState("");
  const [feeText, setFeeText] = useState("");
  const [date, setDate] = useState(todayISO());
  const cur = MARKETS[market].currency;
  const cashOk = account.currency === cur;
  const [moveCash, setMoveCash] = useState(cashOk);
  const units = market === "IDX" ? Number(unitsTextIn) : parseUnits(unitsTextIn);
  const shares = market === "IDX" ? units * LOT : units;
  const price = priceText.trim() ? parsePrice(market, priceText) : (t.info?.price ?? NaN);
  const fee = feeText.trim() ? parsePrice(market, feeText) : 0;
  const gross = Number.isFinite(shares) && Number.isFinite(price) ? shares * price : NaN;
  const total = side === "buy" ? gross + fee : gross - fee;
  const held = holdings.find((h) => h.market === market && h.symbol === t.clean);
  const unitsOk = market === "IDX" ? Number.isInteger(units) && units > 0 : units > 0;
  const valid = unitsOk && price > 0 && fee >= 0 && total > 0 && (side === "buy" || (!!held && held.shares >= shares - 1e-9));
  const money = (v: number) => (cur === "USD" ? formatMoney(Math.round(v * 100), "USD") : formatIDR(Math.round(v)));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () =>
            m.tradeStock(me.id, {
              accountId: account.id, side, market, symbol: t.clean, name: t.info?.name ?? null, lots: units, price, fee, date, moveCash: moveCash && cashOk,
            }),
          side === "buy" ? "Pembelian tercatat" : "Penjualan tercatat",
        );
        if (ok) onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={cx("rounded-full py-2 text-sm font-semibold", side === s ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}
          >
            {s === "buy" ? "Beli" : "Jual"}
          </button>
        ))}
      </div>
      {side === "sell" && holdings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {holdings.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => (setMarket(h.market), t.setSymbol(h.symbol), setMoveCash(account.currency === MARKETS[h.market].currency))}
              className={cx("rounded-full px-3 py-1 text-xs font-bold", held?.id === h.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}
            >
              {label(h)} · {unitsText(h.market, h.shares)}
            </button>
          ))}
        </div>
      )}
      <MarketSelect
        value={market}
        onChange={(mk) => {
          setMarket(mk);
          t.setSymbol("");
          setUnitsText(mk === "IDX" ? "1" : "");
          setMoveCash(account.currency === MARKETS[mk].currency);
        }}
      />
      <TickerField t={t} market={market} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={unitLabel(market)} hint={side === "sell" && held ? `Punya ${unitsText(market, held.shares)}` : market === "IDX" ? "1 lot = 100 lembar" : undefined}>
          <Input inputMode="decimal" value={unitsTextIn} placeholder={market === "CRYPTO" ? "0,005" : market === "GOLD" ? "5" : "1"} onChange={(e) => setUnitsText(e.target.value)} />
        </Field>
        <Field label={priceLabel(market)} hint={!priceText.trim() && t.info ? "Harga terakhir" : undefined}>
          <Input inputMode="decimal" value={priceText} placeholder={t.info ? formatPrice(market, t.info.price) : ""} onChange={(e) => setPriceText(e.target.value)} />
        </Field>
      </div>
      <Field label={`Biaya (opsional, ${cur === "USD" ? "US$" : "Rp"})`} hint="Fee broker/exchange + pajak">
        <Input inputMode="decimal" value={feeText} placeholder="0" onChange={(e) => setFeeText(e.target.value)} />
      </Field>
      <DatePicker label="Tanggal" value={date} max={todayISO()} onChange={setDate} />
      <label className={cx("flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm", cashOk ? "text-slate-700" : "text-slate-400")}>
        <input type="checkbox" disabled={!cashOk} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={moveCash && cashOk} onChange={(e) => setMoveCash(e.target.checked)} />
        <span>
          {side === "buy" ? "Potong" : "Tambahkan ke"} saldo kas {account.name}
          <span className="block text-xs text-slate-500">
            {cashOk ? "Dicatat sebagai koreksi, bukan pengeluaran/pemasukan." : `Kas akun ini dalam ${account.currency}, harga dalam ${cur}. Catat pindah uangnya lewat transfer.`}
          </span>
        </span>
      </label>
      {Number.isFinite(total) && total > 0 && (
        <p className="rounded-2xl bg-sun-100 px-4 py-2.5 text-sm text-slate-700">
          {side === "buy" ? "Total bayar" : "Uang diterima"} <b className="num">{money(total)}</b>
          {cur === "USD" && <span className="text-slate-500"> ≈ {formatIDR(Math.round(toIdr(market, total)))}</span>}
          {side === "sell" && held && price > 0 && (
            <span className="block text-xs text-slate-500">Untung/rugi ≈ {money(shares * (price - held.avg_price) - fee)}</span>
          )}
        </p>
      )}
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" disabled={!valid || !t.clean}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

function SetHoldingForm({ account, holding, onDone }: { account: Account; holding?: Holding; onDone: () => void }) {
  const { me } = useCurrent();
  const [market, setMarket] = useState<Market>(holding?.market ?? "IDX");
  const t = useTicker(market, holding?.symbol ?? "");
  const [unitsTextIn, setUnitsText] = useState(holding ? String(holding.market === "IDX" ? holding.shares / LOT : holding.shares).replace(".", ",") : "");
  const [avgText, setAvgText] = useState(holding ? String(Math.round(holding.avg_price * 100) / 100).replace(".", ",") : "");
  const units = parseUnits(unitsTextIn);
  const shares = market === "IDX" ? Math.round(units * LOT) : units;
  const avg = avgText.trim() ? parsePrice(market, avgText) : NaN;
  const valid = !!t.clean && Number.isFinite(units) && units >= 0 && avg >= 0 && (market !== "IDX" || Number.isInteger(shares));
  const cur = MARKETS[market].currency;
  const money = (v: number) => (cur === "USD" ? formatMoney(Math.round(v * 100), "USD") : formatIDR(Math.round(v)));

  const save = (sharesToSet: number) =>
    attempt(
      () => m.setHolding(me.id, { accountId: account.id, market, symbol: t.clean, name: t.info?.name ?? null, shares: sharesToSet, avgPrice: Number.isFinite(avg) ? avg : 0 }),
      sharesToSet === 0 ? "Dihapus" : "Disimpan",
    );

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await save(shares)) onDone();
      }}
    >
      <p className="text-sm text-slate-600">
        {holding ? "Ubah jumlah atau harga rata-rata." : "Catat investasi yang sudah kamu punya. Saldo kas tidak berubah."}
      </p>
      <MarketSelect value={market} disabled={!!holding} onChange={(mk) => (setMarket(mk), t.setSymbol(""))} />
      <TickerField t={t} market={market} disabled={!!holding} />
      <div className="grid grid-cols-2 gap-3">
        <Field label={unitLabel(market)} hint={market === "IDX" && units > 0 ? `${shares.toLocaleString("id-ID")} lembar` : undefined}>
          <Input inputMode="decimal" value={unitsTextIn} placeholder={market === "CRYPTO" ? "0,005" : "5"} onChange={(e) => setUnitsText(e.target.value)} />
        </Field>
        <Field label={`Harga rata-rata (${cur === "USD" ? "US$" : "Rp"})`} hint={market === "GOLD" ? "per gram" : market === "CRYPTO" ? "per koin" : "per lembar"}>
          <Input inputMode="decimal" value={avgText} placeholder={t.info ? formatPrice(market, t.info.price) : ""} onChange={(e) => setAvgText(e.target.value)} />
        </Field>
      </div>
      {valid && units > 0 && (
        <p className="rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          Modal {money(shares * avg)}
          {t.info && <> · nilai sekarang <b className="num">{formatIDR(Math.round(toIdr(market, shares * t.info.price)))}</b></>}
        </p>
      )}
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {holding && (
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm(`Hapus ${label(holding)} dari ${account.name}? Saldo kas tidak berubah.`) && (await save(0))) onDone();
              }}
            >
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone}>
            Batal
          </Button>
          <Button type="submit" disabled={!valid || units <= 0}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}
