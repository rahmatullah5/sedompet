import { useEffect, useState } from "react";
import { LOT, m, q, type Account, type Holding } from "../db/repo";
import { can } from "../lib/permissions";
import { formatCompact, formatIDR, parseAmount, todayISO } from "../lib/format";
import { lookupStock, priceTime, refreshMarket, stockPrice, useMarketStatus } from "../lib/market";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Button, cx, Field, Input, STICKY_ACTIONS } from "./ui";
import { DatePicker } from "./DatePicker";
import { ChangePct, LineIcon } from "./LineIcon";

/** Market value of a holding (live price, else average buy price). */
export const holdingValue = (h: Holding) => Math.round(h.shares * (h.price ?? h.avg_price));

/** Compact list of holdings shown under an account row. */
export function HoldingLines({ holdings }: { holdings: Holding[] }) {
  if (!holdings.length) return null;
  return (
    <ul className="space-y-0.5">
      {holdings.map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">{h.symbol}</span>
            <span className="text-slate-500">{h.shares / LOT} lot</span>
            <ChangePct value={h.change_pct} />
          </span>
          <span className="num font-semibold text-slate-700">{formatIDR(holdingValue(h))}</span>
        </li>
      ))}
    </ul>
  );
}

type Mode = { kind: "list" } | { kind: "trade"; side: "buy" | "sell"; symbol?: string } | { kind: "set"; holding?: Holding };

/** The "Saham" sheet of an investment account: holdings, live prices, buy/sell. */
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
  const cost = holdings.reduce((s, h) => s + Math.round(h.shares * h.avg_price), 0);
  const gain = value - cost;
  const fetchedAt = holdings.map((h) => h.price_at).filter(Boolean).sort().pop();

  if (mode.kind === "trade")
    return <TradeForm account={account} side={mode.side} symbol={mode.symbol} holdings={holdings} onDone={() => setMode({ kind: "list" })} />;
  if (mode.kind === "set") return <SetHoldingForm account={account} holding={mode.holding} onDone={() => setMode({ kind: "list" })} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">Kas (RDN)</p>
          <p className="num text-sm font-bold text-slate-800">{formatCompact(account.balance)}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">Nilai saham</p>
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

      {holdings.length ? (
        <ul className="divide-y divide-slate-100">
          {holdings.map((h) => {
            const v = holdingValue(h);
            const g = v - Math.round(h.shares * h.avg_price);
            const pct = h.avg_price > 0 && h.price ? ((h.price - h.avg_price) / h.avg_price) * 100 : null;
            return (
              <li key={h.id}>
                <button
                  type="button"
                  disabled={!allowed}
                  onClick={() => setMode({ kind: "set", holding: h })}
                  className="flex w-full items-center gap-3 rounded-2xl px-1 py-2.5 text-left enabled:hover:bg-slate-50"
                >
                  <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-extrabold text-slate-700">{h.symbol}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{h.name ?? h.symbol}</span>
                    <span className="block text-xs text-slate-500">
                      {h.shares / LOT} lot · rata² {formatIDR(Math.round(h.avg_price))}
                    </span>
                    <span className="flex gap-2 text-xs text-slate-500">
                      {h.price ? <>harga {formatIDR(h.price)}</> : <span className="text-amber-700">harga belum ada</span>}
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
      ) : (
        <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Belum ada saham. Catat saham yang sudah dimiliki, atau catat pembelian baru.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          {market.loading ? "Mengambil harga…" : market.error ? `Gagal update: ${market.error}` : fetchedAt ? `Harga per ${priceTime(fetchedAt)} (bisa tertunda ±15 menit)` : ""}
        </span>
        <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-700" onClick={() => refreshMarket(true)} disabled={market.loading}>
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

/** Ticker field that looks the code up on IDX and reports name + price. */
function useTicker(initial: string) {
  const [symbol, setSymbol] = useState(initial);
  const [info, setInfo] = useState<{ name: string | null; price: number } | null>(() => {
    const p = initial ? stockPrice(initial) : null;
    return p ? { name: p.name, price: p.price } : null;
  });
  const [checking, setChecking] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const clean = symbol.trim().toUpperCase();
  useEffect(() => {
    setNotFound(false);
    if (!/^[A-Z0-9]{4}$/.test(clean)) {
      setInfo(null);
      return;
    }
    const cached = stockPrice(clean);
    if (cached) setInfo({ name: cached.name, price: cached.price });
    let live = true;
    setChecking(true);
    const t = window.setTimeout(async () => {
      try {
        const p = await lookupStock(clean);
        if (!live) return;
        if (p) setInfo({ name: p.name, price: p.price });
        else if (!cached) setNotFound(true);
      } catch {
        /* offline: keep what we have */
      } finally {
        if (live) setChecking(false);
      }
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [clean]);
  return { symbol, setSymbol, clean, info, checking, notFound };
}

function TickerField({ t, disabled }: { t: ReturnType<typeof useTicker>; disabled?: boolean }) {
  return (
    <Field
      label="Kode saham"
      hint={t.checking && !t.info ? "Mencari…" : t.notFound ? "Kode tidak ditemukan di BEI" : t.info ? `${t.info.name ?? t.clean} · ${formatIDR(t.info.price)}` : "4 huruf, mis. BBCA, TLKM"}
    >
      <Input
        value={t.symbol}
        disabled={disabled}
        maxLength={6}
        autoCapitalize="characters"
        placeholder="BBCA"
        onChange={(e) => t.setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        className="uppercase"
      />
    </Field>
  );
}

function TradeForm({ account, side: initialSide, symbol, holdings, onDone }: { account: Account; side: "buy" | "sell"; symbol?: string; holdings: Holding[]; onDone: () => void }) {
  const { me } = useCurrent();
  const [side, setSide] = useState(initialSide);
  const t = useTicker(symbol ?? (initialSide === "sell" ? (holdings[0]?.symbol ?? "") : ""));
  const [lotsText, setLotsText] = useState("1");
  const [priceText, setPriceText] = useState("");
  const [feeText, setFeeText] = useState("");
  const [date, setDate] = useState(todayISO());
  const [moveCash, setMoveCash] = useState(true);
  const lots = Number(lotsText);
  const price = priceText.trim() ? parseAmount(priceText) : (t.info?.price ?? NaN);
  const fee = feeText.trim() ? parseAmount(feeText) : 0;
  const gross = Number.isFinite(lots) && Number.isFinite(price) ? lots * LOT * price : NaN;
  const total = side === "buy" ? gross + fee : gross - fee;
  const held = holdings.find((h) => h.symbol === t.clean);
  const valid = Number.isInteger(lots) && lots > 0 && price > 0 && fee >= 0 && total > 0 && (side === "buy" || (!!held && held.shares >= lots * LOT));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () => m.tradeStock(me.id, { accountId: account.id, side, symbol: t.clean, name: t.info?.name ?? null, lots, price, fee, date, moveCash }),
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
              onClick={() => t.setSymbol(h.symbol)}
              className={cx("rounded-full px-3 py-1 text-xs font-bold", t.clean === h.symbol ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600")}
            >
              {h.symbol} · {h.shares / LOT} lot
            </button>
          ))}
        </div>
      )}
      <TickerField t={t} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jumlah lot" hint={side === "sell" && held ? `Punya ${held.shares / LOT} lot` : "1 lot = 100 lembar"}>
          <Input inputMode="numeric" value={lotsText} onChange={(e) => setLotsText(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Harga per lembar" hint={!priceText.trim() && t.info ? "Harga terakhir" : undefined}>
          <Input inputMode="numeric" value={priceText} placeholder={t.info ? String(t.info.price) : "mis. 9150"} onChange={(e) => setPriceText(e.target.value)} />
        </Field>
      </div>
      <Field label="Biaya broker (opsional)" hint="Fee beli/jual + pajak, dalam rupiah">
        <Input inputMode="numeric" value={feeText} placeholder="0" onChange={(e) => setFeeText(e.target.value)} />
      </Field>
      <DatePicker label="Tanggal" value={date} max={todayISO()} onChange={setDate} />
      <label className="flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={moveCash} onChange={(e) => setMoveCash(e.target.checked)} />
        <span>
          {side === "buy" ? "Potong" : "Tambahkan ke"} saldo kas {account.name}
          <span className="block text-xs text-slate-500">Dicatat sebagai koreksi, bukan pengeluaran/pemasukan.</span>
        </span>
      </label>
      {Number.isFinite(total) && total > 0 && (
        <p className="rounded-2xl bg-sun-100 px-4 py-2.5 text-sm text-slate-700">
          {side === "buy" ? "Total bayar" : "Uang diterima"} <b className="num">{formatIDR(Math.round(total))}</b>
          {side === "sell" && held && price > 0 && (
            <span className="block text-xs text-slate-500">
              Untung/rugi ≈ {formatIDR(Math.round(lots * LOT * (price - held.avg_price) - fee))}
            </span>
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
  const t = useTicker(holding?.symbol ?? "");
  const [lotsText, setLotsText] = useState(holding ? String(holding.shares / LOT) : "");
  const [avgText, setAvgText] = useState(holding ? String(Math.round(holding.avg_price)) : "");
  const lots = Number(lotsText);
  const avg = avgText.trim() ? parseAmount(avgText) : NaN;
  const shares = Math.round(lots * LOT);
  const valid = !!t.clean && Number.isFinite(lots) && lots >= 0 && Number.isInteger(shares) && avg >= 0;

  const save = (sharesToSet: number) =>
    attempt(
      () => m.setHolding(me.id, { accountId: account.id, symbol: t.clean, name: t.info?.name ?? null, shares: sharesToSet, avgPrice: Number.isFinite(avg) ? avg : 0 }),
      sharesToSet === 0 ? "Saham dihapus" : "Saham disimpan",
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
        {holding ? "Ubah jumlah lot atau harga rata-rata." : "Catat saham yang sudah kamu punya. Saldo kas tidak berubah."}
      </p>
      <TickerField t={t} disabled={!!holding} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jumlah lot" hint={Number.isFinite(lots) && lots > 0 ? `${shares.toLocaleString("id-ID")} lembar` : undefined}>
          <Input inputMode="decimal" value={lotsText} placeholder="mis. 5" onChange={(e) => setLotsText(e.target.value.replace(",", "."))} />
        </Field>
        <Field label="Harga rata-rata" hint="Rupiah per lembar">
          <Input inputMode="numeric" value={avgText} placeholder={t.info ? String(t.info.price) : "mis. 9150"} onChange={(e) => setAvgText(e.target.value)} />
        </Field>
      </div>
      {valid && lots > 0 && (
        <p className="rounded-2xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          Modal {formatIDR(Math.round(shares * avg))}
          {t.info && <> · nilai sekarang <b className="num">{formatIDR(Math.round(shares * t.info.price))}</b></>}
        </p>
      )}
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {holding && (
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm(`Hapus ${holding.symbol} dari ${account.name}? Saldo kas tidak berubah.`) && (await save(0))) onDone();
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
          <Button type="submit" disabled={!valid || lots <= 0}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}
