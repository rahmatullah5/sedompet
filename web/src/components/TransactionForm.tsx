import { useMemo, useState } from "react";
import { m, q, type Kind, type Transaction } from "../db/repo";
import { can } from "../lib/permissions";
import { formatCompact, formatIDR, parseAmount, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Button, cx, Field, Input, Modal, STICKY_ACTIONS } from "./ui";
import { DatePicker } from "./DatePicker";
import { AccountPicker, CategoryPicker } from "./Pickers";

const QUICK = [10_000, 25_000, 50_000, 100_000];

export function TransactionForm({ open, onClose, editing }: { open: boolean; onClose: () => void; editing?: Transaction | null }) {
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Ubah transaksi" : "Catat transaksi"}>
      {/* Remount per transaction so the form starts from fresh values. */}
      {open && <FormBody key={editing?.id ?? "new"} onClose={onClose} editing={editing ?? null} />}
    </Modal>
  );
}

function FormBody({ onClose, editing }: { onClose: () => void; editing: Transaction | null }) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id).filter((a) => a.visibility === "shared" || a.owner_member_id === me.id);

  const [kind, setKind] = useState<Kind>(editing?.kind ?? "expense");
  const [amountText, setAmountText] = useState(editing ? String(editing.amount) : "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.category_id ?? null);
  // New entries start on an account you hold (if any), else the first one.
  const [accountId, setAccountId] = useState(
    editing?.account_id ?? (accounts.find((a) => (a.holder_member_id ?? a.owner_member_id) === me.id) ?? accounts[0])?.id ?? "",
  );
  const [paidBy, setPaidBy] = useState(editing?.paid_by ?? me.id);
  const [payerTouched, setPayerTouched] = useState(!!editing);
  // Picking someone's account assumes they paid, until you choose otherwise.
  const pickAccount = (id: string) => {
    setAccountId(id);
    const holder = accounts.find((a) => a.id === id)?.holder_member_id;
    if (!payerTouched && holder) setPaidBy(holder);
  };
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);

  const categories = q.categories(dompet.id, kind);
  const amount = parseAmount(amountText);
  const isMine = !editing || editing.created_by === me.id;
  const allowed = editing ? can.editTransaction(me.role, isMine, editing.account_holder_id === me.id) : can.addTransaction(me.role);
  const valid = Number.isFinite(amount) && amount > 0 && accountId;

  const selectedAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);

  async function save() {
    const ok = await attempt(
      () =>
        m.saveTransaction(me.id, {
          id: editing?.id,
          kind,
          amount,
          account_id: accountId,
          category_id: categoryId,
          date,
          note,
          paid_by: paidBy,
        }),
      editing ? "Transaksi diperbarui" : "Tercatat! Keluarga bisa langsung lihat.",
    );
    if (ok) onClose();
  }

  async function remove() {
    if (!editing || !confirm("Hapus transaksi ini?")) return;
    if (await attempt(() => m.deleteTransaction(me.id, editing.id), "Transaksi dihapus")) onClose();
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && allowed) save();
      }}
    >
      {!allowed && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          {me.role === "viewer"
            ? "Peranmu 'Hanya lihat': kamu bisa melihat tapi tidak bisa mencatat."
            : `Ini dicatat oleh ${editing?.created_by_name ?? "anggota lain"}. Anggota hanya bisa mengubah catatan sendiri.`}
        </p>
      )}
      <fieldset disabled={!allowed} className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1">
          {(["expense", "income"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setCategoryId(null);
              }}
              className={cx(
                "rounded-full py-2 text-sm font-bold transition",
                kind === k ? (k === "expense" ? "bg-brand-600 text-white shadow-sm" : "bg-mint-600 text-white shadow-sm") : "text-slate-500",
              )}
            >
              {k === "expense" ? "Pengeluaran" : "Pemasukan"}
            </button>
          ))}
        </div>

        <Field label="Berapa?" hint={Number.isFinite(amount) && amount > 0 ? formatIDR(amount) : undefined}>
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="25rb"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="py-2.5 text-center !text-3xl font-extrabold tracking-tight"
          />
        </Field>
        <div className="-mt-2 flex flex-wrap justify-center gap-1.5">
          {QUICK.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmountText(String(v))}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-brand-100 hover:text-brand-800"
            >
              {formatCompact(v)}
            </button>
          ))}
        </div>

        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />

        <div className="space-y-3">
          <AccountPicker accounts={accounts} value={accountId} onChange={pickAccount} />
          <DatePicker label="Tanggal" value={date} onChange={setDate} />
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
            {kind === "expense" ? "Siapa yang bayar?" : "Siapa yang terima?"}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {members.map((mem) => (
              <button
                key={mem.id}
                type="button"
                onClick={() => (setPaidBy(mem.id), setPayerTouched(true))}
                aria-pressed={paidBy === mem.id}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-3 text-sm transition",
                  paidBy === mem.id
                    ? "border-brand-600 bg-brand-50 font-medium ring-1 ring-brand-600 dark:border-brand-500 dark:bg-brand-700/40 dark:ring-brand-500"
                    : "border-slate-200 dark:border-slate-700",
                )}
              >
                <Avatar emoji={mem.emoji} colour={mem.colour} size={24} />
                {mem.name}
              </button>
            ))}
          </div>
          {selectedAccount?.visibility === "private" && (
            <p className="mt-1.5 text-xs text-violet-600 dark:text-violet-300">🔒 Akun pribadi: transaksi ini hanya terlihat olehmu.</p>
          )}
        </div>

        {noteOpen || note ? (
          <Field label="Catatan">
            <Input value={note} maxLength={140} autoFocus={noteOpen && !note} placeholder="mis. Belanja sayur di pasar" onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className="text-sm font-semibold text-brand-700">
            + Tambah catatan
          </button>
        )}
      </fieldset>

      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {editing && allowed && (
            <Button variant="danger" onClick={remove}>
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          {allowed && (
            <Button type="submit" disabled={!valid}>
              Simpan
            </Button>
          )}
        </div>
      </div>
      {editing && (
        <p className="text-xs text-slate-400">
          Dicatat oleh {editing.created_by_name ?? "anggota yang sudah keluar"}
        </p>
      )}
    </form>
  );
}
