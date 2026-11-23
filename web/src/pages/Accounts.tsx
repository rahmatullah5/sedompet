import { useState } from "react";
import { DatePicker } from "../components/DatePicker";
import { accountTypeIcon, accountTypeLabel, BUILTIN_ACCOUNT_TYPES, m, q, type Account, type Holding } from "../db/repo";
import { Icon, IconPicker } from "../components/Icon";
import { TransferBody } from "../components/TransferForm";
import { can } from "../lib/permissions";
import { formatIDR, todayISO } from "../lib/format";
import { CURRENCIES, currencyInfo, formatMoney, formatRate, isBase, moneyInputText, parseMoney } from "../lib/currency";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { liveRate, priceTime, refreshMarket, useMarketStatus } from "../lib/market";
import { HoldingLines, StockPanel } from "../components/StockPanel";
import { ChangePct, CurrencyCode, LineIcon } from "../components/LineIcon";
import { attempt, Avatar, Button, Card, Field, Input, Modal, Money, Select, STICKY_ACTIONS } from "../components/ui";
import { getMode } from "../cloud/client";
import { cloud } from "../cloud/sync";

const CLOUD = getMode() === "cloud";

const COLOURS = ["#f47c5a", "#4f8ef7", "#2fb67c", "#8b74e8", "#e5689b", "#f5a524", "#8a7563"];
const NEW_TYPE = "__new__";

/** "-2jt", "−150.000", "-12.50": a signed amount in `currency`'s minor units. */
function parseSigned(text: string, currency: string) {
  const t = text.trim().replace(/^−/, "-");
  return t.startsWith("-") ? -parseMoney(t.slice(1), currency) : parseMoney(t, currency);
}

/** "16250", "16.250", "16.250,5", "16250.5", "0,0047" -> number. */
function parseRate(text: string) {
  const t = text.trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ""));
  return Number(t);
}

/** Accounts grouped by type, in first-seen order, with a rupiah subtotal. */
function groupByType(accounts: Account[]) {
  const groups = new Map<string, { type: string; accounts: Account[]; total: number }>();
  for (const a of accounts) {
    const g = groups.get(a.type) ?? { type: a.type, accounts: [], total: 0 };
    g.accounts.push(a);
    g.total += a.balance_base;
    groups.set(a.type, g);
  }
  return [...groups.values()];
}

function Balance({ a }: { a: Account }) {
  const negative = a.balance < 0;
  return (
    <span className="flex flex-col items-end">
      <Money amount={a.balance} currency={a.currency} className={negative ? "text-red-600" : undefined} />
      {!isBase(a.currency) && <span className="num whitespace-nowrap text-[11px] text-slate-400">≈ {formatIDR(a.balance_base)}</span>}
    </span>
  );
}

/** Breakdown per account type: e.g. Kartu kredit −10 jt + Tunai 30 jt = 20 jt. */
function TypeSummary({ accounts }: { accounts: Account[] }) {
  const groups = groupByType(accounts).sort((x, y) => y.total - x.total);
  const total = accounts.reduce((s, a) => s + a.balance_base, 0);
  const foreign = accounts.some((a) => !isBase(a.currency));
  if (groups.length < 2 && !foreign) return null;
  return (
    <Card title="Ringkasan per jenis">
      <ul className="space-y-1.5">
        {groups.map((g) => (
          <li key={g.type} className="flex items-center gap-2 px-2 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
              <Icon value={accountTypeIcon(g.type)} size={16} />
            </span>
            <span className="flex-1 font-semibold text-slate-700">
              {accountTypeLabel(g.type)} <span className="text-xs font-normal text-slate-400">· {g.accounts.filter((a) => !a.parent_id).length} akun</span>
            </span>
            <span className={`num font-bold ${g.total < 0 ? "text-red-600" : "text-slate-800"}`}>{formatIDR(g.total)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-2">
        <span className="text-sm font-bold text-slate-800">Total posisi</span>
        <span className={`num text-lg font-extrabold ${total < 0 ? "text-red-600" : "text-slate-800"}`}>{formatIDR(total)}</span>
      </div>
      {foreign && <p className="mt-1 px-2 text-xs text-slate-400">Mata uang asing dihitung ke Rupiah dengan kurs terkini (otomatis), kecuali akun yang kursnya diatur manual.</p>}
    </Card>
  );
}

/** Today's rates for the currencies the family holds, with refresh. */
function RatesCard({ accounts }: { accounts: Account[] }) {
  const market = useMarketStatus();
  const codes = [...new Set(accounts.filter((a) => !isBase(a.currency)).map((a) => a.currency))];
  if (!codes.length) return null;
  const rows = codes.map((c) => ({ code: c, live: liveRate(c) }));
  const at = rows.map((r) => r.live?.fetched_at).filter(Boolean).sort().pop();
  return (
    <Card
      title="Kurs hari ini"
      action={
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 disabled:text-slate-400" disabled={market.loading} onClick={() => refreshMarket(true)}>
          <LineIcon name="refresh" size={14} />
          {market.loading ? "Memuat…" : "Perbarui"}
        </button>
      }
    >
      <ul className="grid grid-cols-2 gap-2">
        {rows.map(({ code, live }) => (
          <li key={code} className="rounded-2xl bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">1 {code}</p>
            <p className="num font-bold text-slate-800">{live ? formatRate(live.price) : "—"}</p>
            {live?.change_pct != null && (
              <p className="text-[11px]">
                <ChangePct value={live.change_pct} />
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 px-1 text-xs text-slate-400">
        {market.error ? `Gagal update (${market.error}). Pakai kurs terakhir.` : at ? `Diperbarui ${priceTime(at)}. Otomatis tiap 10 menit saat aplikasi dibuka.` : "Belum ada kurs. Sambungkan internet."}
      </p>
    </Card>
  );
}

export function Accounts() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id);
  const [editing, setEditing] = useState<Account | "new" | "new-private" | null>(null);
  const [correcting, setCorrecting] = useState<Account | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [exchange, setExchange] = useState<{ from: string; to: string } | null>(null);
  const [addingCurrency, setAddingCurrency] = useState<Account | null>(null);
  const [stocksOf, setStocksOf] = useState<Account | null>(null);
  const holdings = q.holdings(dompet.id, me.id);
  const holdingsOf = (id: string): Holding[] => holdings.filter((h) => h.account_id === id);
  const shared = accounts.filter((a) => a.visibility === "shared");
  const priv = accounts.filter((a) => a.visibility === "private");
  const manage = can.manage(me.role);
  const canEdit = (a: Account) =>
    manage || (a.visibility === "private" && a.owner_member_id === me.id) || (a.visibility === "shared" && a.holder_member_id === me.id);

  const list = (items: Account[]) => {
    const groups = groupByType(items);
    return groups.map((g) => (
      <div key={g.type}>
        {groups.length > 1 && (
          <p className="flex justify-between px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>{accountTypeLabel(g.type)}</span>
            <span className="num normal-case">{formatIDR(g.total)}</span>
          </p>
        )}
        {rows(g.accounts)}
      </div>
    ));
  };
  const chip = "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200";
  const rows = (items: Account[]) => {
    // Currencies of a pocket are listed under its main account.
    const kidsOf = (id: string) => items.filter((a) => a.parent_id === id);
    const top = items.filter((a) => !a.parent_id || !items.some((p) => p.id === a.parent_id));
    return (
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {top.map((a) => {
          const kids = kidsOf(a.id);
          const pocket = kids.length > 0;
          const stocks = holdingsOf(a.id);
          const investing = isBase(a.currency) && (stocks.length > 0 || a.type === "investment");
          const pocketTotal = pocket ? [a, ...kids].reduce((s, x) => s + x.balance_base, 0) : 0;
          return (
            <li key={a.id} className="py-1">
              <div className="flex items-center gap-1">
                <button
                  disabled={!canEdit(a)}
                  onClick={() => setEditing(a)}
                  className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left enabled:hover:bg-slate-50"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl" style={{ background: `${a.colour}22` }}>
                    <Icon value={a.icon ?? accountTypeIcon(a.type)} size={26} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-800">{a.name}</span>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                      {accountTypeLabel(a.type)}
                      {pocket ? (
                        <span className="whitespace-nowrap">· {kids.length + 1} mata uang</span>
                      ) : (
                        !isBase(a.currency) && <CurrencyCode code={a.currency} />
                      )}
                      {stocks.length > 0 && <span className="whitespace-nowrap">· {stocks.length} saham</span>}
                      {a.visibility === "shared" && a.holder_name && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 font-semibold text-slate-600">
                            {a.holder_emoji} {a.holder_member_id === me.id ? "kamu" : a.holder_name}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  {pocket ? (
                    <span className="flex flex-col items-end">
                      <span className={`num font-bold ${pocketTotal < 0 ? "text-red-600" : ""}`}>{formatIDR(pocketTotal)}</span>
                      <span className="text-[11px] text-slate-400">total dalam Rupiah</span>
                    </span>
                  ) : stocks.length > 0 ? (
                    <span className="flex flex-col items-end">
                      <span className="num font-bold">{formatIDR(a.balance_base)}</span>
                      <span className="num text-[11px] text-slate-400">kas {formatIDR(a.balance)}</span>
                    </span>
                  ) : (
                    <Balance a={a} />
                  )}
                </button>
                {can.addTransaction(me.role) && !pocket && (
                  <button
                    onClick={() => setCorrecting(a)}
                    title="Koreksi saldo"
                    aria-label={`Koreksi saldo ${a.name}`}
                    className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <LineIcon name="adjust" size={18} />
                  </button>
                )}
              </div>
              {pocket && (
                <ul className="ml-5 mr-1 space-y-0.5 border-l-2 border-sky-100 pl-2 sm:ml-14 sm:pl-3">
                  {[a, ...kids].map((c) => (
                    <li key={c.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={!canEdit(c)}
                        onClick={() => setEditing(c)}
                        className="flex flex-1 items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-sm enabled:hover:bg-slate-50"
                      >
                        <span className="flex flex-col whitespace-nowrap font-semibold text-slate-700">
                          {c.currency}
                          {!isBase(c.currency) && (
                            <span className="text-[11px] font-normal text-slate-400">
                              @ {formatRate(c.fx_rate)}
                              {c.fx_auto === 0 && " manual"}
                            </span>
                          )}
                        </span>
                        <Balance a={c} />
                      </button>
                      {can.addTransaction(me.role) && (
                        <button onClick={() => setCorrecting(c)} title="Koreksi saldo" aria-label={`Koreksi saldo ${c.name}`} className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                          <LineIcon name="adjust" size={16} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {stocks.length > 0 && (
                <div className="ml-5 mr-3 border-l-2 border-mint-100 pl-2 sm:ml-14 sm:pl-3">
                  <HoldingLines holdings={stocks} />
                </div>
              )}
              {(pocket || investing) && (
                <div className="ml-5 mt-1.5 flex flex-wrap gap-1.5 pb-1 sm:ml-14">
                  {pocket && can.addTransaction(me.role) && (
                    <button type="button" className={chip} onClick={() => setExchange({ from: a.id, to: kids[0].id })}>
                      <LineIcon name="swap" size={14} />
                      Tukar valas
                    </button>
                  )}
                  {pocket && canEdit(a) && (
                    <button type="button" className={chip} onClick={() => setAddingCurrency(a)}>
                      <LineIcon name="plus" size={14} />
                      Mata uang
                    </button>
                  )}
                  {investing && (
                    <button type="button" className={chip} onClick={() => setStocksOf(a)}>
                      <LineIcon name="chart" size={14} />
                      Saham
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">← Menu</a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Isi dompet</h1>
        <p className="text-sm text-slate-500">Tempat uang keluarga disimpan: tunai, bank, e-wallet.</p>
        {can.addTransaction(me.role) && accounts.length >= 2 && (
          <Button variant="secondary" className="mt-3" onClick={() => setTransferOpen(true)}>
            <LineIcon name="swap" />
            Transfer antar akun
          </Button>
        )}
      </div>
      <div className="space-y-4">
        <TypeSummary accounts={accounts} />
        <RatesCard accounts={accounts} />
        <Card
          title={`Akun bersama · ${formatIDR(shared.reduce((s, a) => s + a.balance_base, 0))}`}
          action={manage && <Button onClick={() => setEditing("new")}>+ Akun</Button>}
        >
          <p className="-mt-1 mb-2 px-2 text-xs text-slate-400">Saldo beda dengan aplikasi bank? Tekan <LineIcon name="adjust" size={12} className="inline-block align-[-1px]" /> untuk koreksi.</p>
          {list(shared)}
          {!manage && <p className="px-2 pt-2 text-xs text-slate-400">Hanya pemilik/admin yang bisa menambah akun bersama.</p>}
        </Card>
        <Card
          title={
            <span className="flex items-center gap-2">
              <LineIcon name="lock" size={16} className="text-slate-500" /> Akun pribadimu <span className="text-xs font-normal text-slate-400">hanya kamu yang lihat</span>
            </span>
          }
          action={can.addPrivateAccount(me.role) && <Button variant="secondary" onClick={() => setEditing("new-private")}>+ Pribadi</Button>}
        >
          {priv.length ? list(priv) : <p className="px-2 text-sm text-slate-500">Simpan tabungan atau dompet pribadi di sini. Anggota lain tidak bisa melihat saldonya.</p>}
        </Card>
      </div>
      <AccountForm
        editing={editing}
        onClose={() => setEditing(null)}
        onAddCurrency={(a) => (setEditing(null), setAddingCurrency(a))}
        onStocks={(a) => (setEditing(null), setStocksOf(a))}
      />
      <Modal open={addingCurrency !== null} onClose={() => setAddingCurrency(null)} title="Tambah mata uang">
        {addingCurrency && <AddCurrencyForm key={addingCurrency.id} parent={addingCurrency} onClose={() => setAddingCurrency(null)} />}
      </Modal>
      <Modal open={exchange !== null} onClose={() => setExchange(null)} title="Tukar valas">
        {exchange && <TransferBody initialFrom={exchange.from} initialTo={exchange.to} onClose={() => setExchange(null)} />}
      </Modal>
      <Modal open={stocksOf !== null} onClose={() => setStocksOf(null)} title={stocksOf ? `Saham · ${stocksOf.name}` : "Saham"}>
        {stocksOf && <StockPanel key={stocksOf.id} account={stocksOf} onClose={() => setStocksOf(null)} />}
      </Modal>
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer antar akun">
        {transferOpen && <TransferBody onClose={() => setTransferOpen(false)} />}
      </Modal>
      <Modal open={correcting !== null} onClose={() => setCorrecting(null)} title="Koreksi saldo">
        {correcting && <CorrectionForm key={correcting.id} account={correcting} onClose={() => setCorrecting(null)} />}
      </Modal>
    </div>
  );
}

function AccountForm({
  editing,
  onClose,
  onAddCurrency,
  onStocks,
}: {
  editing: Account | "new" | "new-private" | null;
  onClose: () => void;
  onAddCurrency: (a: Account) => void;
  onStocks: (a: Account) => void;
}) {
  const open = editing !== null;
  const isNew = typeof editing === "string";
  const title = editing === "new-private" ? "Akun pribadi baru" : isNew ? "Akun baru" : editing?.parent_id ? `${editing.currency} · ${editing.name}` : "Ubah akun";
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open && (
        <AccountFormBody
          key={isNew ? editing : editing.id}
          account={isNew ? null : editing}
          initialVisibility={editing === "new-private" ? "private" : undefined}
          onClose={onClose}
          onAddCurrency={onAddCurrency}
          onStocks={onStocks}
        />
      )}
    </Modal>
  );
}

function AccountFormBody({
  account,
  initialVisibility,
  onClose,
  onAddCurrency,
  onStocks,
}: {
  account: Account | null;
  initialVisibility?: "private";
  onClose: () => void;
  onAddCurrency: (a: Account) => void;
  onStocks: (a: Account) => void;
}) {
  // A currency inside a pocket: only its balance and rate are its own.
  const isChild = !!account?.parent_id;
  const { me } = useCurrent();
  const manage = can.manage(me.role);
  const [name, setName] = useState(account?.name ?? "");
  const { dompet: dompetForTypes } = useCurrent();
  const customTypes = q.customAccountTypes(dompetForTypes.id);
  const [type, setType] = useState<string>(account?.type ?? "bank");
  const [newType, setNewType] = useState("");
  const [currency, setCurrency] = useState(account?.currency ?? "IDR");
  const [rateText, setRateText] = useState(account && !isBase(account.currency) ? String(account.fx_rate_saved) : "");
  const [fxAuto, setFxAuto] = useState(account ? account.fx_auto !== 0 : true);
  const live = isBase(currency) ? null : liveRate(currency);
  const [opening, setOpening] = useState(account ? moneyInputText(account.opening_balance, account.currency) : "0");
  const [colour, setColour] = useState(account?.colour ?? COLOURS[1]);
  const [icon, setIcon] = useState<string>(account?.icon ?? accountTypeIcon(account?.type ?? "bank"));
  const finalType = type === NEW_TYPE ? newType.trim() : type;
  // Auto: the live rate (saved as the offline fallback); manual: what was typed.
  const typedRate = parseRate(rateText);
  const rate = isBase(currency) ? 1 : fxAuto ? (live?.price ?? (typedRate > 0 ? typedRate : (account?.fx_rate_saved ?? NaN))) : typedRate;
  // Stored amounts are minor units of the currency, so it's fixed once used.
  const hasTx = !!account && q.transactions(account.dompet_id, me.id, { accountId: account.id, limit: 1 }).length > 0;
  const [visibility, setVisibility] = useState<"shared" | "private">(account?.visibility ?? initialVisibility ?? (manage ? "shared" : "private"));
  const openingValue = opening.trim() === "" ? 0 : parseSigned(opening, currency);
  const { members, dompet } = useCurrent();
  const currentHolder = account ? (account.holder_member_id ?? account.owner_member_id ?? null) : null;
  const [holderId, setHolderId] = useState<string | null>(currentHolder);
  const [movePaidBy, setMovePaidBy] = useState(true);
  const ownsPrivate = account?.visibility === "private" && account.owner_member_id === me.id;
  // Who may change the holder: admins, or the owner of a private account (handover).
  const canAssign = manage || ownsPrivate;
  const handover = !!account && (holderId !== currentHolder || visibility !== account.visibility);
  const othersPaid = account && holderId
    ? q.transactions(dompet.id, me.id, { accountId: account.id }).filter((t) => !t.flag && t.paid_by !== holderId).length
    : 0;

  async function save() {
    const ok = await attempt(
      async () => {
        if (account && handover) {
          // Handovers go through the server function in cloud mode (it may move
          // the account out of your sight, and can update old transactions).
          if (CLOUD) await cloud.assignAccount(account.id, holderId, visibility, movePaidBy && othersPaid > 0);
          else await m.assignAccount(me.id, account.id, holderId, visibility, movePaidBy && othersPaid > 0);
          // A private account handed to someone else is no longer ours to edit.
          if (visibility === "private" && holderId !== me.id) return;
        }
        await m.saveAccount(me.id, {
          id: account?.id, name, type: finalType, opening_balance: openingValue, colour, icon, visibility, currency, fx_rate: rate, fx_auto: fxAuto,
          holder_member_id: visibility === "shared" && manage ? holderId : undefined,
        });
      },
      "Akun disimpan",
    );
    if (ok) onClose();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {isChild ? (
        <p className="text-sm text-slate-600">
          Saldo <b>{currency}</b> di dompet valas ini. Nama, ikon dan pemegang mengikuti akun utamanya.
        </p>
      ) : (
      <Field label="Nama akun">
        <Input autoFocus value={name} maxLength={40} placeholder="mis. BCA Keluarga, GoPay Ibu" onChange={(e) => setName(e.target.value)} />
      </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        {!isChild && (
        <Field label="Jenis / kelompok">
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value;
              // Follow the type's default icon unless a custom one was chosen.
              const defaults = [...BUILTIN_ACCOUNT_TYPES.map((x) => x.icon), "👛"];
              if (defaults.includes(icon)) setIcon(accountTypeIcon(t === NEW_TYPE ? "" : t));
              setType(t);
            }}
          >
            {BUILTIN_ACCOUNT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
            {customTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={NEW_TYPE}>+ Jenis baru…</option>
          </Select>
        </Field>
        )}
        <Field label="Mata uang" hint={isChild ? undefined : hasTx ? "Tetap, sudah ada transaksi" : undefined}>
          <Select value={currency} disabled={hasTx || isChild} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {type === NEW_TYPE && (
        <Field label="Nama jenis baru" hint="Akun dengan jenis sama dikelompokkan dan dijumlahkan.">
          <Input autoFocus value={newType} maxLength={30} placeholder="mis. Emas, Reksa dana, Paylater" onChange={(e) => setNewType(e.target.value)} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={`Saldo awal${isBase(currency) ? "" : ` (${currency})`}`}
          hint={Number.isFinite(openingValue) ? formatMoney(openingValue, currency) : "Tidak valid"}
        >
          <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
        {!isBase(currency) && !fxAuto && (
          <Field label={`Kurs 1 ${currency} = Rp`} hint={Number.isFinite(rate) && rate > 0 ? formatIDR(rate) : "Isi kurs"}>
            <Input inputMode="decimal" value={rateText} placeholder={live ? String(Math.round(live.price)) : "mis. 16250"} onChange={(e) => setRateText(e.target.value)} />
          </Field>
        )}
        {!isBase(currency) && fxAuto && (
          <div className="rounded-2xl bg-sky-50 px-3 py-2">
            <p className="text-xs font-semibold text-sky-800">Kurs otomatis</p>
            <p className="num text-sm font-bold text-slate-800">{live ? `1 ${currency} = ${formatRate(live.price)}` : "Menunggu internet…"}</p>
            {live && <p className="text-[11px] text-slate-500">per {priceTime(live.fetched_at)}</p>}
          </div>
        )}
      </div>
      {!isBase(currency) && (
        <label className="-mt-1 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand-600)]" checked={fxAuto} onChange={(e) => setFxAuto(e.target.checked)} />
          Ikuti kurs pasar otomatis
          {fxAuto && !live && (
            <Input inputMode="decimal" className="!w-28 !py-1 text-xs" value={rateText} placeholder="kurs sementara" onChange={(e) => setRateText(e.target.value)} />
          )}
        </label>
      )}
      {account && !isChild && (
        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-50 p-2.5">
          {canEditPocket(account, me.id, manage) && (
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => onAddCurrency(account)}>
              <LineIcon name="coins" size={14} />
              Mata uang lain (valas)
            </Button>
          )}
          {isBase(account.currency) && (
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => onStocks(account)}>
              <LineIcon name="chart" size={14} />
              Saham di akun ini
            </Button>
          )}
          <p className="w-full px-1 text-[11px] text-slate-400">Satu akun bisa menyimpan banyak mata uang (seperti BCA Valas) dan saham BEI.</p>
        </div>
      )}
      {finalType === "credit" && <p className="-mt-1 text-xs text-slate-400">Tagihan kartu kredit: isi saldo awal negatif, mis. -2jt.</p>}
      {!isChild && (
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Ikon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      )}
      {canAssign && !isChild && (
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Dipegang oleh</span>
          <div className="flex flex-wrap gap-1.5">
            {manage && (
              <button
                type="button"
                onClick={() => (setHolderId(null), setVisibility("shared"))}
                aria-pressed={holderId === null}
                className={`rounded-full border-2 px-3 py-1 text-sm font-semibold ${holderId === null ? "border-brand-600 bg-brand-50 text-brand-800" : "border-transparent bg-slate-100 text-slate-600"}`}
              >
                Keluarga
              </button>
            )}
            {members.map((mem) => {
              const pending = CLOUD && !mem.user_id;
              const on = holderId === mem.id;
              return (
                <button
                  key={mem.id}
                  type="button"
                  onClick={() => setHolderId(mem.id)}
                  aria-pressed={on}
                  className={`flex items-center gap-1.5 rounded-full border-2 py-0.5 pl-0.5 pr-3 text-sm font-semibold ${on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-transparent bg-slate-100 text-slate-600"}`}
                >
                  <Avatar emoji={mem.emoji} colour={mem.colour} size={24} />
                  {mem.id === me.id ? "Saya" : mem.name}
                  {pending && <span className="text-[10px] font-medium text-slate-400">belum gabung</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Pemegang bisa mencatat, mengubah semua transaksi di akun ini, dan mengoreksi saldonya, termasuk yang dulu kamu catatkan untuknya.
          </p>
        </div>
      )}
      {!isChild && (
      <Field label="Siapa yang bisa lihat">
        <Select
          value={visibility}
          disabled={!manage && !ownsPrivate}
          onChange={(e) => {
            const v = e.target.value as "shared" | "private";
            setVisibility(v);
            if (v === "private" && !holderId) setHolderId(me.id);
          }}
        >
          {(manage || visibility === "shared") && <option value="shared">Seluruh anggota Dompet</option>}
          <option value="private">Hanya {holderId && holderId !== me.id ? members.find((x) => x.id === holderId)?.name : "saya"}</option>
        </Select>
      </Field>
      )}
      {account && handover && holderId && othersPaid > 0 && (
        <label className="flex items-start gap-2 rounded-2xl bg-sun-100 px-3 py-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={movePaidBy} onChange={(e) => setMovePaidBy(e.target.checked)} />
          <span>
            Ubah “dibayar oleh” di <b>{othersPaid}</b> transaksi lama menjadi <b>{members.find((x) => x.id === holderId)?.name}</b>
            <span className="block text-xs text-slate-500">Cocok kalau selama ini kamu yang mencatatkan untuknya.</span>
          </span>
        </label>
      )}
      {account && visibility === "private" && holderId && holderId !== me.id && (
        <p className="rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-700">Setelah disimpan, akun ini pindah ke {members.find((x) => x.id === holderId)?.name} dan tidak terlihat lagi olehmu.</p>
      )}
      <div className={isChild ? "hidden" : "flex gap-2"}>
        {COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Warna ${c}`}
            onClick={() => setColour(c)}
            className="h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-slate-900"
            style={{ background: c, boxShadow: colour === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }}
          />
        ))}
      </div>
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {account && (
            <Button
              variant="danger"
              onClick={async () => {
                const kids = q.accounts(account.dompet_id, me.id).filter((x) => x.parent_id === account.id).length;
                if (confirm(`Hapus ${isChild ? `${account.currency} dari dompet valas` : `akun ${account.name}`}? Semua transaksinya${kids ? ` dan ${kids} mata uang lainnya` : ""} ikut terhapus.`) && (await attempt(() => m.deleteAccount(me.id, account.id), "Akun dihapus")))
                  onClose();
              }}
            >
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={!name.trim() || !finalType || !Number.isFinite(openingValue) || !(rate > 0)}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

function CorrectionForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { me } = useCurrent();
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  const actual = parseSigned(text, account.currency);
  const diff = Number.isFinite(actual) ? Math.round(actual) - account.balance : NaN;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => m.correctBalance(me.id, account.id, actual, date), "Saldo dikoreksi")) onClose();
      }}
    >
      <p className="text-sm text-slate-600">
        Saldo <b>{account.name}</b> di Sedompet sekarang <b className="num">{formatMoney(account.balance, account.currency)}</b>. Masukkan saldo yang sebenarnya
        (lihat di aplikasi bank/e-wallet).
      </p>
      <Field label="Saldo sebenarnya">
        <Input autoFocus inputMode="decimal" value={text} placeholder={isBase(account.currency) ? "mis. 2.350.000" : "mis. 1250.75"} onChange={(e) => setText(e.target.value)} className="py-3 text-center !text-2xl font-extrabold" />
      </Field>
      {Number.isFinite(diff) && text.trim() !== "" && (
        <p className={`rounded-2xl px-4 py-2.5 text-sm ${diff === 0 ? "bg-slate-100 text-slate-600" : "bg-sun-100 text-slate-700"}`}>
          {diff === 0
            ? "Sudah sama. Tidak perlu koreksi."
            : `Akan dicatat koreksi ${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff), account.currency)}. Tidak dihitung sebagai pemasukan atau pengeluaran.`}
        </p>
      )}
      <DatePicker label="Per tanggal" value={date} max={todayISO()} onChange={setDate} />
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!Number.isFinite(diff) || diff === 0 || text.trim() === ""}>
          Koreksi
        </Button>
      </div>
    </form>
  );
}

const canEditPocket = (a: Account, me: string, manage: boolean) =>
  manage || (a.visibility === "private" && a.owner_member_id === me) || (a.visibility === "shared" && a.holder_member_id === me);

/** Adds a currency to a pocket (e.g. SGD into BCA Valas). */
function AddCurrencyForm({ parent, onClose }: { parent: Account; onClose: () => void }) {
  const { dompet, me } = useCurrent();
  const taken = new Set(q.accounts(dompet.id, me.id).filter((a) => a.id === parent.id || a.parent_id === parent.id).map((a) => a.currency));
  const options = CURRENCIES.filter((c) => !taken.has(c.code));
  const [currency, setCurrency] = useState(options.find((c) => c.code !== "IDR")?.code ?? options[0]?.code ?? "USD");
  const [opening, setOpening] = useState("0");
  const value = opening.trim() === "" ? 0 : parseSigned(opening, currency);
  const live = isBase(currency) ? null : liveRate(currency);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => m.addPocketCurrency(me.id, parent.id, currency, value), `${currency} ditambahkan ke ${parent.name}`)) onClose();
      }}
    >
      <p className="text-sm text-slate-600">
        Simpan beberapa mata uang di <b>{parent.name}</b>, seperti tabungan valas di bank. Tiap mata uang punya saldo sendiri; totalnya dihitung ke Rupiah dengan kurs terkini.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mata uang">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {options.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Saldo awal (${currency})`} hint={Number.isFinite(value) ? formatMoney(value, currency) : "Tidak valid"}>
          <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
      </div>
      {live && (
        <p className="rounded-2xl bg-sky-50 px-4 py-2 text-sm text-slate-700">
          1 {currency} = <b className="num">{formatRate(live.price)}</b>
          {Number.isFinite(value) && value !== 0 && <> · saldo ≈ <b className="num">{formatIDR(Math.round((value / 10 ** currencyInfo(currency).decimals) * live.price))}</b></>}
        </p>
      )}
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!options.length || !Number.isFinite(value)}>
          Tambah
        </Button>
      </div>
    </form>
  );
}
