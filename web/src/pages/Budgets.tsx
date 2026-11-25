import { useState } from "react";
import { deleteWithUndo } from "../lib/undo";
import { MultiCategoryPicker } from "../components/Pickers";
import { m, q, type Budget, type BudgetPeriod } from "../db/repo";
import { can } from "../lib/permissions";
import { currentMonth, formatIDR, parseAmount, periodRange, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Badge, Button, Card, Empty, Field, Input, Modal, Progress, STICKY_ACTIONS } from "../components/ui";
import { MonthNav } from "./Transactions";
import { Icon } from "../components/Icon";

/** Days left (incl. today) in the budget's current period; 0 when not useful. */
function parseIds(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Icon(s) for a budget card: member, its single category, or up to 3 of its categories. */
export function BudgetIcon({ b, size = 28 }: { b: Budget; size?: number }) {
  const icons = parseIds(b.category_icons);
  if (b.member_emoji || icons.length < 2) return <Icon value={b.member_emoji ?? b.category_icon ?? "💰"} size={size} />;
  return (
    <span className="inline-flex -space-x-2">
      {icons.slice(0, 3).map((ic, i) => (
        <span key={i} className="rounded-full bg-white ring-2 ring-white">
          <Icon value={ic} size={size * 0.8} />
        </span>
      ))}
    </span>
  );
}

function daysLeft(month: string, period: BudgetPeriod) {
  if (month !== currentMonth() || period === "daily") return 0;
  const now = new Date();
  if (period === "weekly") return 7 - ((now.getDay() + 6) % 7);
  return Math.round((Date.parse(periodRange(month).to) - Date.parse(todayISO())) / 86_400_000) + 1;
}

export const PERIODS: { value: BudgetPeriod; label: string; per: string }[] = [
  { value: "daily", label: "Harian", per: "hari" },
  { value: "weekly", label: "Mingguan", per: "minggu" },
  { value: "monthly", label: "Bulanan", per: "bulan" },
];
export const perLabel = (p: BudgetPeriod) => PERIODS.find((x) => x.value === p)?.per ?? "bulan";

export function Budgets() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const budgets = q.budgets(dompet.id, month);
  const manage = can.manage(me.role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Anggaran</h1>
          <p className="text-sm text-slate-500">Rencana belanja harian, mingguan, atau bulanan keluarga dan uang saku anak.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
      </div>
      {manage && (
        <Button className="w-full" variant="secondary" onClick={() => setEditing("new")}>
          + Buat anggaran baru
        </Button>
      )}
      <p className="px-1 text-xs text-slate-400">
        Dihitung dari akun bersama. Tabungan pribadi tidak ikut dihitung.
        {!manage && " Hanya pemilik/admin yang bisa mengubah anggaran."}
      </p>

      {budgets.length === 0 ? (
        <Card>
          <Empty icon="" title="Belum ada anggaran">
            {manage ? "Buat anggaran, misalnya jajan harian, belanja dapur mingguan, atau uang saku bulanan anak." : null}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {budgets.map((b) => {
            const left = b.limit - b.spent;
            const over = left < 0;
            const days = daysLeft(month, b.period);
            const period = PERIODS.find((p) => p.value === b.period)!;
            return (
              <Card key={b.id}>
                <button className="w-full text-left disabled:cursor-default" disabled={!manage} onClick={() => setEditing(b)}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <BudgetIcon b={b} /> {b.name}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone="brand">
                          {formatIDR(b.amount)}/{period.per}
                        </Badge>
                        <Badge>
                          {b.category_name ?? (parseIds(b.exclude_category_ids).length
                            ? `Semua kecuali ${parseIds(b.exclude_category_ids).length} kategori`
                            : "Semua pengeluaran")}
                        </Badge>
                        {b.carry_from && <Badge tone="amber">Sisa terbawa</Badge>}
                        {b.member_name && (
                          <Badge tone="violet">
                            {b.member_emoji} Uang saku {b.member_name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {over ? <Badge tone="amber">Lewat batas</Badge> : null}
                  </div>
                  <p className="mb-1 text-xs font-semibold text-slate-500">{b.periodLabel}</p>
                  <Progress value={b.spent} max={b.limit} />
                  <div className="mt-2 flex justify-between text-sm">
                    <span className="num text-slate-600 dark:text-slate-300">
                      {formatIDR(b.spent)} <span className="text-slate-400">/ {formatIDR(b.limit)}</span>
                    </span>
                    <span className={over ? "font-medium text-red-600" : "text-slate-500"}>
                      {over ? `lebih ${formatIDR(-left)}` : `sisa ${formatIDR(left)}`}
                    </span>
                  </div>
                  {b.carry > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Batas {formatIDR(b.amount)} + sisa {period.value === "daily" ? "hari" : period.value === "weekly" ? "minggu" : "bulan"} sebelumnya {formatIDR(b.carry)}
                    </p>
                  )}
                  {days > 1 && !over && (
                    <p className="mt-1 text-xs text-slate-400">
                      ≈ {formatIDR(Math.floor(left / days))}/hari untuk {days} hari lagi
                    </p>
                  )}
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <BudgetForm editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function BudgetForm({ editing, onClose }: { editing: Budget | "new" | null; onClose: () => void }) {
  const open = editing !== null;
  return (
    <Modal open={open} onClose={onClose} title={editing === "new" ? "Anggaran baru" : "Ubah anggaran"}>
      {open && <BudgetFormBody key={editing === "new" ? "new" : editing.id} budget={editing === "new" ? null : editing} onClose={onClose} />}
    </Modal>
  );
}

function BudgetFormBody({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { dompet, me, members } = useCurrent();
  const categories = q.categories(dompet.id, "expense");
  const [name, setName] = useState(budget?.name ?? "");
  const [amountText, setAmountText] = useState(budget ? String(budget.amount) : "");
  const [categoryIds, setCategoryIds] = useState<string[]>(() =>
    budget?.category_id ? [budget.category_id] : parseIds(budget?.category_ids),
  );
  const [memberId, setMemberId] = useState(budget?.member_id ?? "");
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? "monthly");
  const [carry, setCarry] = useState(!!budget?.carry_from);
  const [excludes, setExcludes] = useState<string[]>(() => {
    try {
      return JSON.parse(budget?.exclude_category_ids ?? "[]");
    } catch {
      return [];
    }
  });
  const amount = parseAmount(amountText);

  async function save() {
    const ok = await attempt(
      () =>
        m.saveBudget(me.id, {
          id: budget?.id,
          name: (name || categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(" + ") || "Anggaran").slice(0, 40),
          amount,
          category_id: null,
          category_ids: categoryIds,
          member_id: memberId || null,
          exclude_category_ids: excludes,
          period,
          carry,
        }),
      "Anggaran disimpan",
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
      <Field label="Nama">
        <Input value={name} maxLength={40} placeholder="mis. Belanja Dapur" onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Periode">
        <div className="grid grid-cols-3 gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={`flex flex-col items-center gap-0.5 rounded-2xl border py-2 text-sm transition ${period === p.value ? "border-brand-600 bg-brand-50 font-semibold text-brand-800 ring-1 ring-brand-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Batas per ${perLabel(period)}`} hint={amount > 0 ? formatIDR(amount) : period === "daily" ? "Contoh: 50rb" : period === "weekly" ? "Contoh: 500rb" : "Contoh: 3jt, 750rb"}>
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-brand-600)]" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-700">Sisa terbawa ke {perLabel(period)} berikutnya</span>
          <span className="block text-xs text-slate-500">
            {amount > 0
              ? `Mis. batas ${formatIDR(amount)}, terpakai ${formatIDR(Math.round(amount * 0.6))} → ${perLabel(period)} depan bisa pakai ${formatIDR(amount + amount - Math.round(amount * 0.6))}.`
              : `Yang tidak terpakai menambah batas ${perLabel(period)} berikutnya.`}{budget && !budget.carry_from && ` Dihitung mulai ${perLabel(period)} lalu.`}
          </span>
        </span>
      </label>
      <Field label="Kategori (bisa pilih beberapa)" hint={categoryIds.length ? `${categoryIds.length} kategori dipilih` : "Kosong = semua pengeluaran"}>
        <div className="space-y-1.5">
          <button
            type="button"
            aria-pressed={categoryIds.length === 0}
            onClick={() => setCategoryIds([])}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition ${categoryIds.length === 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            Semua pengeluaran
          </button>
          <MultiCategoryPicker categories={categories} value={categoryIds} onChange={setCategoryIds} />
        </div>
      </Field>
      {categoryIds.length === 0 && (
        <details className="group rounded-2xl bg-slate-50 px-3 py-2" open={excludes.length > 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">
            <span>
              Kecuali kategori… {excludes.length > 0 && <span className="text-brand-700">({excludes.length})</span>}
            </span>
            <span className="text-slate-400 group-open:hidden">+</span>
            <span className="hidden text-slate-400 group-open:inline">−</span>
          </summary>
          <div className="pt-2">
          <div className="flex flex-wrap gap-1.5">
            {categories
              .filter((c) => !c.parent_id)
              .map((c) => {
                const on = excludes.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setExcludes(on ? excludes.filter((x) => x !== c.id) : [...excludes, c.id])}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${on ? "bg-slate-800 text-white line-through" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    <Icon value={c.icon} size={14} /> {c.name}
                  </button>
                );
              })}
          </div>
          <p className="mt-1 text-xs text-slate-400">Mis. kecualikan Cicilan Rumah supaya anggaran harian lebih realistis.</p>
          </div>
        </details>
      )}
      <Field label="Untuk siapa" hint="Pilih anggota untuk membuat uang saku: hanya pengeluaran yang dibayar orang itu yang dihitung.">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setMemberId("")}
            className={`rounded-full border px-3 py-1 text-sm ${memberId === "" ? "border-brand-600 bg-brand-50 font-medium ring-1 ring-brand-600 dark:border-brand-500 dark:bg-brand-700/40 dark:ring-brand-500" : "border-slate-200 dark:border-slate-700"}`}
          >
            Seluruh keluarga
          </button>
          {members.map((mem) => (
            <button
              key={mem.id}
              type="button"
              onClick={() => setMemberId(mem.id)}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-3 text-sm ${memberId === mem.id ? "border-brand-600 bg-brand-50 font-medium ring-1 ring-brand-600 dark:border-brand-500 dark:bg-brand-700/40 dark:ring-brand-500" : "border-slate-200 dark:border-slate-700"}`}
            >
              <Avatar emoji={mem.emoji} colour={mem.colour} size={24} />
              {mem.name}
            </button>
          ))}
        </div>
      </Field>
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {budget && (
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm(`Hapus anggaran ${budget.name}?`) && (await deleteWithUndo(() => m.deleteBudget(me.id, budget.id), "Anggaran dihapus", me))) onClose();
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
          <Button type="submit" disabled={!(amount > 0)}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}
