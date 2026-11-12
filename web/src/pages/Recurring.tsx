import { useState } from "react";
import { AccountPicker, CategoryPicker } from "../components/Pickers";
import { DatePicker } from "../components/DatePicker";
import { q, type Kind } from "../db/repo";
import { describeFrequency, mm, mq, type Frequency, type Recurring as Rec } from "../db/money";
import { can } from "../lib/permissions";
import { formatDay, formatIDR, parseAmount, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Badge, Button, Card, cx, Empty, Field, Input, Modal, Select, STICKY_ACTIONS } from "../components/ui";
import { Icon, IconPicker } from "../components/Icon";

/** Monthly-equivalent amount, for the "per bulan" totals. */
function perMonth(r: Rec) {
  const f = r.frequency === "weekly" ? 52 / 12 : r.frequency === "monthly" ? 1 : 1 / 12;
  return (r.amount * f) / r.every;
}

/** Due-items strip, shown on Beranda and here. */
export function DueList() {
  useDbVersion();
  const { dompet, me } = useCurrent();
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
                {formatIDR(r.amount)}
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
  const billsMonthly = bills.filter((r) => r.active).reduce((s, r) => s + perMonth(r), 0);
  const incomeMonthly = incomes.filter((r) => r.active).reduce((s, r) => s + perMonth(r), 0);

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
              </span>
              <span className={cx("num font-bold", r.kind === "income" ? "text-mint-600" : "text-slate-800")}>{formatIDR(r.amount)}</span>
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

      <Card
        title={
          <span className="flex items-center gap-2">
            🧾 Tagihan & langganan <Badge>≈ {formatIDR(Math.round(billsMonthly))}/bln</Badge>
          </span>
        }
        action={manage && <Button variant="secondary" onClick={() => setEditing("expense")}>+ Tagihan</Button>}
      >
        {list(bills)}
      </Card>
      <Card
        title={
          <span className="flex items-center gap-2">
            💼 Pemasukan rutin <Badge tone="brand">≈ {formatIDR(Math.round(incomeMonthly))}/bln</Badge>
          </span>
        }
        action={manage && <Button variant="secondary" onClick={() => setEditing("income")}>+ Pemasukan</Button>}
      >
        {list(incomes)}
      </Card>
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
  const [amountText, setAmountText] = useState(item ? String(item.amount) : "");
  const [accountId, setAccountId] = useState(item?.account_id ?? accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "");
  const [paidBy, setPaidBy] = useState(item?.paid_by ?? "");
  const [frequency, setFrequency] = useState<Frequency>(item?.frequency ?? "monthly");
  const [every, setEvery] = useState(item?.every ?? 1);
  const [nextDate, setNextDate] = useState(item?.next_date ?? todayISO());
  const [endDate, setEndDate] = useState(item?.end_date ?? "");
  const amount = parseAmount(amountText);

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
      <Field label="Nama">
        <Input value={name} maxLength={60} placeholder={kind === "income" ? "mis. Gaji Ayah" : "mis. Netflix"} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Berapa?" hint={amount > 0 ? formatIDR(amount) : undefined}>
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <FrequencyPicker frequency={frequency} every={every} onChange={(f, n) => (setFrequency(f), setEvery(n))} />
      <DatePicker label="Berikutnya" value={nextDate} onChange={setNextDate} presets="future" />
      <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
      <details className="group rounded-2xl bg-slate-50 px-3 py-2" open={!!item && !!(item.category_id || item.end_date || item.paid_by)}>
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
            <Button variant="danger" onClick={async () => confirm(`Hapus ${item.name}?`) && (await attempt(() => mm.deleteRecurring(me.id, item.id), "Dihapus")) && onClose()}>
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
