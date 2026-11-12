import { useState } from "react";
import { CategoryPicker } from "../components/Pickers";
import { m, q, type Budget } from "../db/repo";
import { can } from "../lib/permissions";
import { currentMonth, formatIDR, parseAmount } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Badge, Button, Card, Empty, Field, Input, Modal, Progress, STICKY_ACTIONS } from "../components/ui";
import { MonthNav } from "./Transactions";
import { Icon } from "../components/Icon";

function daysLeftInMonth(month: string) {
  if (month !== currentMonth()) return 0;
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return last - now.getDate() + 1;
}

export function Budgets() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const [month, setMonth] = useState(currentMonth());
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const budgets = q.budgets(dompet.id, month);
  const manage = can.manage(me.role);
  const daysLeft = daysLeftInMonth(month);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Anggaran 🐷</h1>
          <p className="text-sm text-slate-500">Rencana belanja bulanan keluarga dan uang saku anak.</p>
        </div>
        <MonthNav month={month} setMonth={setMonth} />
      </div>
      {manage && (
        <Button className="w-full" variant="secondary" onClick={() => setEditing("new")}>
          + Buat anggaran baru
        </Button>
      )}
      <p className="px-1 text-xs text-slate-400">
        Dihitung dari akun bersama. Tabungan pribadi 🔒 tidak ikut dihitung.
        {!manage && " Hanya pemilik/admin yang bisa mengubah anggaran."}
      </p>

      {budgets.length === 0 ? (
        <Card>
          <Empty icon="🎯" title="Belum ada anggaran">
            {manage ? "Buat anggaran bulanan, misalnya untuk belanja dapur atau uang saku anak." : null}
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {budgets.map((b) => {
            const left = b.amount - b.spent;
            const over = left < 0;
            return (
              <Card key={b.id}>
                <button className="w-full text-left disabled:cursor-default" disabled={!manage} onClick={() => setEditing(b)}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Icon value={b.member_emoji ?? b.category_icon ?? "💰"} size={28} /> {b.name}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>
                          {b.category_name ?? (b.exclude_category_ids && JSON.parse(b.exclude_category_ids).length
                            ? `Semua kecuali ${JSON.parse(b.exclude_category_ids).length} kategori`
                            : "Semua pengeluaran")}
                        </Badge>
                        {b.member_name && (
                          <Badge tone="violet">
                            {b.member_emoji} Uang saku {b.member_name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {over ? <Badge tone="amber">Lewat batas</Badge> : null}
                  </div>
                  <Progress value={b.spent} max={b.amount} />
                  <div className="mt-2 flex justify-between text-sm">
                    <span className="num text-slate-600 dark:text-slate-300">
                      {formatIDR(b.spent)} <span className="text-slate-400">/ {formatIDR(b.amount)}</span>
                    </span>
                    <span className={over ? "font-medium text-red-600" : "text-slate-500"}>
                      {over ? `lebih ${formatIDR(-left)}` : `sisa ${formatIDR(left)}`}
                    </span>
                  </div>
                  {daysLeft > 0 && !over && (
                    <p className="mt-1 text-xs text-slate-400">
                      ≈ {formatIDR(Math.floor(left / daysLeft))}/hari untuk {daysLeft} hari lagi
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
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? "");
  const [memberId, setMemberId] = useState(budget?.member_id ?? "");
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
          name: name || categories.find((c) => c.id === categoryId)?.name || "Anggaran",
          amount,
          category_id: categoryId || null,
          member_id: memberId || null,
          exclude_category_ids: excludes,
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
      <Field label="Batas per bulan" hint={amount > 0 ? formatIDR(amount) : "Contoh: 3jt, 750rb"}>
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <CategoryPicker
        label="Kategori"
        categories={categories}
        value={categoryId || null}
        onChange={(id) => setCategoryId(id ?? "")}
        noneLabel="Semua"
        noneIcon="💰"
      />
      {!categoryId && (
        <details className="group rounded-2xl bg-slate-50 px-3 py-2" open={excludes.length > 0}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-slate-700">
            <span>
              Kecuali kategori… {excludes.length > 0 && <span className="text-brand-700">({excludes.length})</span>}
            </span>
            <span className="text-slate-400 transition group-open:rotate-180">▾</span>
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
            👨‍👩‍👧 Seluruh keluarga
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
                if (confirm(`Hapus anggaran ${budget.name}?`) && (await attempt(() => m.deleteBudget(me.id, budget.id), "Anggaran dihapus"))) onClose();
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
