import { useState } from "react";
import { deleteWithUndo } from "../lib/undo";
import { AccountPicker, CategoryPicker } from "../components/Pickers";
import { DatePicker } from "../components/DatePicker";
import { q, type Kind } from "../db/repo";
import { describeFrequency, mm, mq, occurrences, type Frequency, type Recurring as Rec } from "../db/money";
import { can } from "../lib/permissions";
import { formatCompact, formatDay, formatIDR, getPeriodStartDay, toISODate, todayISO } from "../lib/format";
import { formatMoney, isBase, moneyInputText, parseMoney } from "../lib/currency";
import { useCurrent, useDbVersion, useHideBalance } from "../lib/hooks";
import { attempt, Badge, Button, Card, cx, Empty, Field, Input, Modal, Select, STICKY_ACTIONS } from "../components/ui";
import { Icon, IconPicker } from "../components/Icon";
import { SuggestionList, type Suggestion } from "../components/Suggestions";
import { BillCalendar } from "../components/BillCalendar";

const VIEW_KEY = "sedompet.rutin.view";

/** Monthly-equivalent amount, for the "per bulan" totals. */
// ---------------------------------------------------------------------------
// Projections from real due dates (respects next date and end date), instead
// of averaging a yearly bill into a misleading "per month" figure.
// ---------------------------------------------------------------------------
type WindowKey = "1" | "3" | "12";
const WINDOWS: Record<WindowKey, { label: string; short: string; months: number }> = {
  "1": { label: "Bulan ini", short: "bulan ini", months: 1 },
  "3": { label: "3 bulan", short: "3 bulan", months: 3 },
  "12": { label: "12 bulan", short: "12 bulan", months: 12 },
};

const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const parseISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
function formatShort(iso: string) {
  return shortDate.format(parseISO(iso));
}

const dayMonth = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const PROJ_START_KEY = "sedompet.rutin.projStart";

/**
 * Month-long periods starting on `startDay` (e.g. payday 27: 27 Nov – 26 Des),
 * the first one being the period holding today, counted from today onward.
 * Short months clamp the day (31 -> 30 Nov, 28/29 Feb).
 */
function windowMonths(months: number, startDay: number) {
  const now = new Date();
  const startOf = (y: number, m: number) => new Date(y, m, Math.min(startDay, new Date(y, m + 1, 0).getDate()));
  let first = startOf(now.getFullYear(), now.getMonth());
  if (first > now) first = startOf(now.getFullYear(), now.getMonth() - 1);
  const today = todayISO();
  return Array.from({ length: months }, (_, i) => {
    const start = startOf(first.getFullYear(), first.getMonth() + i);
    const next = startOf(first.getFullYear(), first.getMonth() + i + 1);
    const end = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1);
    return {
      key: toISODate(start),
      label: startDay === 1 ? monthLabel.format(start) : `${dayMonth.format(start)} – ${dayMonth.format(end)}`,
      from: i === 0 ? today : toISODate(start),
      to: toISODate(end),
    };
  });
}

function projectWindow(items: Rec[], key: WindowKey, startDay: number) {
  const months = windowMonths(WINDOWS[key].months, startDay).map((m) => {
    let income = 0;
    let expense = 0;
    const due: { name: string; amount: number; kind: Kind; date: string }[] = [];
    for (const r of items) {
      for (const date of occurrences(r, m.from, m.to)) {
        if (r.kind === "income") income += r.amount_base;
        else expense += r.amount_base;
        due.push({ name: r.name, amount: r.amount_base, kind: r.kind, date });
      }
    }
    return { ...m, income, expense, due };
  });
  return {
    months,
    income: months.reduce((s, m) => s + m.income, 0),
    expense: months.reduce((s, m) => s + m.expense, 0),
  };
}

/** How many more times an item with an end date will happen. */
function remainingCount(r: Rec) {
  return r.end_date ? occurrences(r, todayISO(), r.end_date).length : Infinity;
}

/**
 * For big or infrequent bills: how much to set aside per month until the next
 * due date (e.g. 29 jt due next month -> 29 jt this month, not 2.4 jt/month).
 */
function savingHint(r: Rec): string | null {
  if (!r.active || r.kind !== "expense") return null;
  const infrequent = r.frequency === "yearly" || (r.frequency === "monthly" && r.every >= 2);
  if (!infrequent) return null;
  const now = new Date();
  const due = parseISO(r.next_date);
  const monthsLeft = Math.max(1, (due.getFullYear() - now.getFullYear()) * 12 + (due.getMonth() - now.getMonth()));
  if (due < now) return null; // already due: shown in the due list above
  const perMonth = Math.ceil(r.amount / monthsLeft);
  return monthsLeft === 1
    ? `Siapkan ${formatMoney(r.amount, r.account_currency)} sebelum ${formatShort(r.next_date)}`
    : `Sisihkan ≈ ${formatMoney(perMonth, r.account_currency)}/bulan selama ${monthsLeft} bulan sampai ${formatShort(r.next_date)}`;
}

function OutlookCard({
  windowKey,
  setWindowKey,
  startDay,
  setStartDay,
  outlook,
}: {
  windowKey: WindowKey;
  setWindowKey: (k: WindowKey) => void;
  startDay: number;
  setStartDay: (d: number) => void;
  outlook: ReturnType<typeof projectWindow>;
}) {
  const net = outlook.income - outlook.expense;
  const max = Math.max(1, ...outlook.months.flatMap((m) => [m.income, m.expense]));
  return (
    <Card title="Proyeksi dari yang rutin 📅">
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Periode proyeksi">
        {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={windowKey === k}
            onClick={() => setWindowKey(k)}
            className={cx("rounded-full py-1.5 text-xs font-semibold transition", windowKey === k ? "bg-slate-800 text-white" : "text-slate-500")}
          >
            {WINDOWS[k].label}
          </button>
        ))}
      </div>
      <DayOfMonthPicker value={startDay} onChange={setStartDay} />
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-slate-50 p-2">
          <p className="text-[11px] font-semibold text-slate-500">Tagihan</p>
          <p className="num font-extrabold text-slate-800">{formatCompact(outlook.expense)}</p>
        </div>
        <div className="rounded-2xl bg-mint-100 p-2">
          <p className="text-[11px] font-semibold text-mint-600">Pemasukan</p>
          <p className="num font-extrabold text-slate-800">{formatCompact(outlook.income)}</p>
        </div>
        <div className={cx("rounded-2xl p-2", net < 0 ? "bg-red-50" : "bg-sun-100")}>
          <p className={cx("text-[11px] font-semibold", net < 0 ? "text-red-700" : "text-amber-700")}>Selisih</p>
          <p className="num font-extrabold text-slate-800">{net > 0 ? "+" : net < 0 ? "−" : ""}{formatCompact(Math.abs(net))}</p>
        </div>
      </div>
      {outlook.months.length > 1 && (
        <ul className="mt-3 space-y-1.5">
          {outlook.months.map((m) => (
            <li
              key={m.key}
              className={cx("grid items-center gap-2 text-xs", startDay === 1 ? "grid-cols-[3.5rem_1fr_auto]" : "grid-cols-[6.5rem_1fr_auto]")}
              title={m.due.map((d) => `${d.name} ${d.kind === "income" ? "+" : "−"}${formatIDR(d.amount)}`).join(", ")}
            >
              <span className="font-semibold capitalize text-slate-600">{m.label}</span>
              <span className="space-y-0.5">
                <span className="block h-1.5 rounded-full bg-[#2fb67c]" style={{ width: `${(m.income / max) * 100}%` }} />
                <span className="block h-1.5 rounded-full bg-[#f47c5a]" style={{ width: `${(m.expense / max) * 100}%` }} />
              </span>
              <span className={cx("num text-right font-semibold", m.income - m.expense > 0 ? "text-mint-700" : m.income - m.expense < 0 ? "text-red-700" : "text-slate-400")}>
                {m.income === 0 && m.expense === 0
                  ? "—"
                  : `${m.income - m.expense > 0 ? "+" : m.income - m.expense < 0 ? "−" : ""}${formatCompact(Math.abs(m.income - m.expense))}`}
                {m.due.some((d) => d.kind === "expense" && d.amount >= 5_000_000) && " ⚠️"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Dihitung dari tanggal jatuh tempo sebenarnya. Yang sudah berakhir tidak ikut dihitung. Hijau = pemasukan, oranye = tagihan, angka kanan = selisih (masuk − tagihan), ⚠️ = ada tagihan besar.
      </p>
    </Card>
  );
}

/** Due-items strip, shown on Beranda and here. */
export function DueList() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const [hideAmt] = useHideBalance();
  const due = mq.due(dompet.id, me.id);
  if (due.length === 0) return null;
  const canAct = can.addTransaction(me.role);
  return (
    <Card title={`⏰ Jatuh tempo (${due.length})`} className="pop-in bg-sun-100">
      <ul className="space-y-2">
        {due.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-2xl bg-white p-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50">
              <Icon value={r.icon ?? r.category_icon ?? (r.kind === "income" ? "💼" : "🧾")} size={24} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-slate-800">{r.name}</span>
              <span className="text-xs text-slate-500">
                {formatDay(r.next_date)} · {r.kind === "income" ? "+" : "−"}
                {hideAmt ? "••••" : formatMoney(r.amount, r.account_currency)}
              </span>
            </span>
            {canAct && (
              <>
                <Button className="px-3 py-1.5" onClick={() => attempt(() => mm.recordRecurring(me.id, r.id), `${r.name} tercatat`)}>
                  {r.kind === "income" ? "Terima" : "Bayar"}
                </Button>
                <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => attempt(() => mm.recordRecurring(me.id, r.id, { skip: true }), "Dilewati")}>
                  Lewati
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Recurring() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const items = mq.recurring(dompet.id, me.id);
  const manage = can.manage(me.role);
  const [editing, setEditing] = useState<Rec | Kind | null>(null);
  const bills = items.filter((r) => r.kind === "expense");
  const incomes = items.filter((r) => r.kind === "income");
  const [windowKey, setWindowKey] = useState<WindowKey>("12");
  const [startDay, setStartDayState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(PROJ_START_KEY));
      if (v >= 1 && v <= 31) return v;
    } catch {
      /* private mode */
    }
    return getPeriodStartDay();
  });
  const setStartDay = (d: number) => {
    setStartDayState(d);
    try {
      localStorage.setItem(PROJ_START_KEY, String(d));
    } catch {
      /* private mode */
    }
  };
  const outlook = projectWindow(items, windowKey, startDay);
  const [billView, setBillViewState] = useState<"list" | "calendar">(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  });
  const setBillView = (v: "list" | "calendar") => {
    setBillViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };

  const list = (rs: Rec[]) =>
    rs.length === 0 ? (
      <p className="py-2 text-sm text-slate-400">Belum ada.</p>
    ) : (
      <ul className="-mx-2">
        {rs.map((r) => (
          <li key={r.id}>
            <button
              disabled={!manage}
              onClick={() => setEditing(r)}
              className={cx("flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left enabled:hover:bg-slate-50", !r.active && "opacity-50")}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
                <Icon value={r.icon ?? r.category_icon ?? (r.kind === "income" ? "💼" : "🧾")} size={26} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-800">{r.name}</span>
                <span className="text-xs text-slate-500">
                  {describeFrequency(r.frequency, r.every)} · {r.active ? `berikutnya ${formatDay(r.next_date)}` : "selesai"}
                  {r.paid_by_name && ` · ${r.paid_by_name}`}
                </span>
                {r.active && r.end_date && (
                  <span className="block text-xs text-slate-400">
                    berakhir {formatShort(r.end_date)} · {remainingCount(r)} kali lagi
                  </span>
                )}
                {savingHint(r) && <span className="mt-0.5 block text-xs font-semibold text-amber-700">💡 {savingHint(r)}</span>}
              </span>
              <span className={cx("num font-bold", r.kind === "income" ? "text-mint-600" : "text-slate-800")}>{formatMoney(r.amount, r.account_currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Rutin 🔁</h1>
        <p className="text-sm text-slate-500">Langganan, tagihan sekolah, cicilan, dan pemasukan tetap seperti gaji. Muncul di Beranda saat jatuh tempo.</p>
      </div>

      <DueList />

      {items.some((r) => r.active) && <OutlookCard windowKey={windowKey} setWindowKey={setWindowKey} startDay={startDay} setStartDay={setStartDay} outlook={outlook} />}

      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Tampilan rutin">
        {(
          [
            ["list", "☰ Daftar"],
            ["calendar", "📅 Kalender"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={billView === v}
            onClick={() => setBillView(v)}
            className={cx("rounded-full py-1.5 text-xs font-semibold transition", billView === v ? "bg-slate-800 text-white" : "text-slate-500")}
          >
            {label}
          </button>
        ))}
      </div>
      {billView === "calendar" ? (
        <Card
          title="📅 Kalender rutin"
          action={
            manage && (
              <div className="flex gap-1.5">
                <Button variant="secondary" className="px-3" onClick={() => setEditing("expense")}>
                  + Tagihan
                </Button>
                <Button variant="secondary" className="px-3" onClick={() => setEditing("income")}>
                  + Pemasukan
                </Button>
              </div>
            )
          }
        >
          <BillCalendar dompetId={dompet.id} me={me.id} items={items} onOpen={manage ? setEditing : undefined} />
        </Card>
      ) : (
        <>
          <Card
            title={
              <span className="flex items-center gap-2">
                🧾 Tagihan & langganan <Badge>{formatCompact(outlook.expense)} · {WINDOWS[windowKey].short}</Badge>
              </span>
            }
            action={manage && <Button variant="secondary" onClick={() => setEditing("expense")}>+ Tagihan</Button>}
          >
            {list(bills)}
          </Card>
          <Card
            title={
              <span className="flex items-center gap-2">
                💼 Pemasukan rutin <Badge tone="brand">{formatCompact(outlook.income)} · {WINDOWS[windowKey].short}</Badge>
              </span>
            }
            action={manage && <Button variant="secondary" onClick={() => setEditing("income")}>+ Pemasukan</Button>}
          >
            {list(incomes)}
          </Card>
        </>
      )}
      {!manage && <p className="text-center text-xs text-slate-400">Hanya pemilik/admin yang bisa mengatur yang rutin. Semua anggota bisa menandai “Bayar”.</p>}
      {items.length === 0 && !manage && <Empty icon="🔁" title="Belum ada yang rutin" />}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={typeof editing === "object" && editing ? "Ubah" : editing === "income" ? "Pemasukan rutin baru" : "Tagihan rutin baru"}>
        {editing !== null && (
          <RecurringForm key={typeof editing === "string" ? editing : editing.id} item={typeof editing === "string" ? null : editing} kind={typeof editing === "string" ? editing : editing.kind} onClose={() => setEditing(null)} />
        )}
      </Modal>
    </div>
  );
}

const PRESETS: { name: string; icon: string; kind: Kind; frequency: Frequency }[] = [
  { name: "Netflix", icon: "📺", kind: "expense", frequency: "monthly" },
  { name: "SPP Sekolah", icon: "🎒", kind: "expense", frequency: "monthly" },
  { name: "Listrik PLN", icon: "💡", kind: "expense", frequency: "monthly" },
  { name: "Internet", icon: "📶", kind: "expense", frequency: "monthly" },
  { name: "BPJS", icon: "🏥", kind: "expense", frequency: "monthly" },
  { name: "Cicilan Motor", icon: "🛵", kind: "expense", frequency: "monthly" },
  { name: "Gaji", icon: "💼", kind: "income", frequency: "monthly" },
  { name: "Uang saku anak", icon: "🧒", kind: "expense", frequency: "weekly" },
];

function RecurringForm({ item, kind, onClose }: { item: Rec | null; kind: Kind; onClose: () => void }) {
  const { dompet, me, members } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id);
  const categories = q.categories(dompet.id, kind);
  const [name, setName] = useState(item?.name ?? "");
  const [icon, setIcon] = useState(item?.icon ?? (kind === "income" ? "💼" : "🧾"));
  const [amountText, setAmountText] = useState(item ? moneyInputText(item.amount, item.account_currency) : "");
  const [accountId, setAccountId] = useState(item?.account_id ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "");
  const [paidBy, setPaidBy] = useState(item?.paid_by ?? "");
  const [frequency, setFrequency] = useState<Frequency>(item?.frequency ?? "monthly");
  const [every, setEvery] = useState(item?.every ?? 1);
  const [nextDate, setNextDate] = useState(item?.next_date ?? todayISO());
  const [endDate, setEndDate] = useState(item?.end_date ?? "");
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "IDR";
  const amount = parseMoney(amountText, currency);
  const [moreOpen, setMoreOpen] = useState(!!item && !!(item.category_id || item.end_date || item.paid_by));
  // Suggest from earlier transactions of the same kind while typing a new item.
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestions = showSuggest && !item ? q.suggestions(dompet.id, me.id, name, 5, kind) : [];
  const applySuggestion = (s: Suggestion) => {
    setName(s.note.slice(0, 60));
    setAmountText(moneyInputText(s.amount, accounts.find((a) => a.id === s.account_id)?.currency));
    if (accounts.some((a) => a.id === s.account_id)) setAccountId(s.account_id);
    setCategoryId(s.category_id ?? "");
    if (s.paid_by && members.some((m) => m.id === s.paid_by)) setPaidBy(s.paid_by);
    if (s.category_icon) setIcon(s.category_icon);
    // Show what was filled in under "Pengaturan lain".
    if (s.category_id || s.paid_by) setMoreOpen(true);
    setShowSuggest(false);
  };

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () =>
            mm.saveRecurring(me.id, {
              id: item?.id,
              name,
              icon,
              kind,
              amount,
              account_id: accountId,
              category_id: categoryId || null,
              paid_by: paidBy || null,
              frequency,
              every,
              next_date: nextDate,
              end_date: endDate || null,
            }),
          "Tersimpan",
        );
        if (ok) onClose();
      }}
    >
      {!item && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.filter((p) => p.kind === kind).map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setName(p.name);
                setIcon(p.icon);
                setFrequency(p.frequency);
              }}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-brand-100"
            >
              {p.icon} {p.name}
            </button>
          ))}
        </div>
      )}
      <div>
        <Field label="Nama">
          <Input
            value={name}
            maxLength={60}
            autoComplete="off"
            placeholder={kind === "income" ? "mis. Gaji Ayah" : "mis. Netflix"}
            onChange={(e) => {
              setName(e.target.value);
              setShowSuggest(true);
            }}
            onKeyDown={(e) => e.key === "Escape" && setShowSuggest(false)}
          />
        </Field>
        {showSuggest && <SuggestionList items={suggestions} onPick={applySuggestion} />}
      </div>
      <Field label={isBase(currency) ? "Berapa?" : `Berapa? (${currency})`} hint={amount > 0 ? formatMoney(amount, currency) : undefined}>
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <FrequencyPicker frequency={frequency} every={every} onChange={(f, n) => (setFrequency(f), setEvery(n))} />
      <DatePicker label="Berikutnya" value={nextDate} onChange={setNextDate} presets="future" />
      <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
      <details
        className="group rounded-2xl bg-slate-50 px-3 py-2"
        open={moreOpen}
        onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">
          <span>
            Pengaturan lain <span className="font-normal text-slate-400">· kategori, berakhir, pembayar, ikon</span>
          </span>
          <span className="text-slate-400 transition group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-3 pt-3">
          <CategoryPicker
            label="Kategori"
            categories={categories}
            value={categoryId || null}
            onChange={(id) => setCategoryId(id ?? "")}
            noneLabel="Tanpa"
            noneIcon="➖"
          />
          <DatePicker label="Berakhir" value={endDate} min={nextDate} onChange={setEndDate} optional presets="future" placeholder="Tanpa akhir" />
          <Field label={kind === "income" ? "Diterima oleh" : "Dibayar oleh"}>
            <Select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              <option value="">Siapa pun yang menandai</option>
              {members.map((mem) => (
                <option key={mem.id} value={mem.id}>
                  {mem.emoji} {mem.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Ikon</span>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
      </details>
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {item && (
            <Button variant="danger" onClick={async () => confirm(`Hapus ${item.name}?`) && (await deleteWithUndo(() => mm.deleteRecurring(me.id, item.id), "Dihapus", me)) && onClose()}>
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={!(amount > 0) || !name.trim() || !accountId}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

const FREQS: { value: Frequency; icon: string; label: string; unit: string }[] = [
  { value: "weekly", icon: "🗓️", label: "Mingguan", unit: "minggu" },
  { value: "monthly", icon: "📅", label: "Bulanan", unit: "bulan" },
  { value: "yearly", icon: "🎂", label: "Tahunan", unit: "tahun" },
];

const QUICK_EVERY: { frequency: Frequency; every: number; label: string }[] = [
  { frequency: "weekly", every: 2, label: "2 minggu" },
  { frequency: "monthly", every: 3, label: "3 bulan" },
  { frequency: "monthly", every: 6, label: "6 bulan" },
];

/** How often: three icon tiles plus a − / + stepper for "every N …". */
function FrequencyPicker({ frequency, every, onChange }: { frequency: Frequency; every: number; onChange: (f: Frequency, every: number) => void }) {
  const unit = FREQS.find((f) => f.value === frequency)!.unit;
  const set = (n: number) => onChange(frequency, Math.min(12, Math.max(1, n)));
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">Seberapa sering?</span>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Periode">
        {FREQS.map((f) => {
          const on = f.value === frequency;
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(f.value, 1)}
              className={cx(
                "flex flex-col items-center gap-1 rounded-2xl border-2 py-2.5 text-xs font-semibold transition",
                on ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-transparent bg-slate-50 text-slate-700 hover:bg-slate-100",
              )}
            >
              <span className={cx("flex h-9 w-9 items-center justify-center rounded-xl text-2xl", !on && "bg-white")}>{f.icon}</span>
              {f.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1">
          <button type="button" onClick={() => set(every - 1)} disabled={every <= 1} aria-label="Kurangi" className="h-8 w-8 rounded-full bg-white text-lg font-bold text-slate-600 shadow-sm disabled:opacity-30">
            −
          </button>
          <span className="min-w-28 text-center text-sm font-bold text-slate-800">
            Tiap {every === 1 ? "" : `${every} `}
            {unit}
          </span>
          <button type="button" onClick={() => set(every + 1)} disabled={every >= 12} aria-label="Tambah" className="h-8 w-8 rounded-full bg-white text-lg font-bold text-slate-600 shadow-sm disabled:opacity-30">
            +
          </button>
        </div>
        {QUICK_EVERY.map((q) => {
          const on = q.frequency === frequency && q.every === every;
          return (
            <button
              key={q.label}
              type="button"
              onClick={() => onChange(q.frequency, q.every)}
              className={cx("rounded-full px-3 py-1 text-xs font-semibold transition", on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-brand-100")}
            >
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Bulan dihitung mulai tanggal …": a pill that opens a 1–31 grid, so the
 * month can start on payday (e.g. 25 or 27).
 */
function DayOfMonthPicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  const [open, setOpen] = useState(false);
  const QUICK = [1, 25, 27];
  return (
    <div className="mt-3 rounded-2xl bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-700">Bulan dihitung mulai tanggal</p>
          <p className="text-[11px] text-slate-400">Samakan dengan tanggal gajian</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Mulai tanggal ${value}. Ganti`}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-3 text-sm font-bold text-slate-800 shadow-sm"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs text-white">{value}</span>
          tiap bulan
          <span className={cx("text-[10px] text-slate-400 transition", open && "rotate-180")}>▾</span>
        </button>
      </div>
      {open && (
        <div className="pop-in mt-3">
          <div className="mb-2 flex gap-1.5">
            {QUICK.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => (onChange(d), setOpen(false))}
                className={cx("rounded-full px-3 py-1 text-xs font-semibold", value === d ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm")}
              >
                {d === 1 ? "Awal bulan (1)" : `Tgl ${d}`}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Mulai tanggal">
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={value === d}
                onClick={() => (onChange(d), setOpen(false))}
                className={cx(
                  "num aspect-square rounded-xl text-xs font-semibold transition",
                  value === d ? "bg-brand-600 text-white shadow-sm" : "bg-white text-slate-700 hover:bg-brand-50",
                )}
              >
                {d}
              </button>
            ))}
          </div>
          {value > 28 && <p className="mt-2 text-[11px] text-slate-400">Bulan yang lebih pendek mulai di tanggal terakhirnya.</p>}
        </div>
      )}
    </div>
  );
}
