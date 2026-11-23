import { useState } from "react";
import { deleteWithUndo } from "../lib/undo";
import { m, q } from "../db/repo";
import { can } from "../lib/permissions";
import { formatCompact, todayISO } from "../lib/format";
import { currencyInfo, formatMoney, isBase, minorFactor, moneyInputText, parseMoney } from "../lib/currency";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Button, cx, Field, Input, STICKY_ACTIONS } from "./ui";
import { AccountPicker } from "./Pickers";
import { DatePicker } from "./DatePicker";

const QUICK_FEES = [2_500, 6_500];

/**
 * Move money between two of your accounts. Balances move; spending/income
 * totals don't (only the optional admin fee counts as an expense).
 */
export function TransferBody({
  transferId,
  initialFrom,
  initialTo,
  onClose,
  modeSwitch,
}: {
  transferId?: string | null;
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
  /** The Pengeluaran/Pemasukan/Transfer switch, rendered by the parent sheet. */
  modeSwitch?: React.ReactNode;
}) {
  useDbVersion();
  const { dompet, me } = useCurrent();
  // Your own private accounts plus shared ones (others' private ones aren't listed anyway).
  const accounts = q.accounts(dompet.id, me.id).filter((a) => a.visibility === "shared" || a.owner_member_id === me.id);
  const existing = transferId ? q.transfer(dompet.id, transferId) : null;

  const [fromId, setFromId] = useState(existing?.fromAccountId ?? initialFrom ?? accounts[0]?.id ?? "");
  const [toId, setToId] = useState(existing?.toAccountId ?? initialTo ?? accounts.find((a) => a.id !== (existing?.fromAccountId ?? initialFrom ?? accounts[0]?.id))?.id ?? "");
  const curOf = (id: string | undefined) => accounts.find((a) => a.id === id)?.currency ?? "IDR";
  const [amountText, setAmountText] = useState(existing ? moneyInputText(existing.amount, curOf(existing.fromAccountId)) : "");
  const [toAmountText, setToAmountText] = useState(existing ? moneyInputText(existing.toAmount, curOf(existing.toAccountId)) : "");
  const [feeText, setFeeText] = useState(existing?.fee ? moneyInputText(existing.fee, curOf(existing.fromAccountId)) : "");
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [note, setNote] = useState(existing?.note ?? "");
  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const fromCur = from?.currency ?? "IDR";
  const toCur = to?.currency ?? "IDR";
  const cross = fromCur !== toCur;
  const amount = parseMoney(amountText, fromCur);
  const fee = feeText.trim() ? parseMoney(feeText, fromCur) : 0;
  // Received amount: typed, else estimated from the accounts' rates to rupiah.
  const estimate =
    from && to && amount > 0
      ? Math.round(((amount / minorFactor(fromCur)) * (isBase(fromCur) ? 1 : from.fx_rate)) / (isBase(toCur) ? 1 : to.fx_rate) * minorFactor(toCur))
      : NaN;
  const toAmount = !cross ? amount : toAmountText.trim() ? parseMoney(toAmountText, toCur) : estimate;
  const valid =
    Number.isFinite(amount) && amount > 0 && Number.isFinite(fee) && fee >= 0 && fromId && toId && fromId !== toId && Number.isFinite(toAmount) && toAmount > 0;
  const allowed = can.addTransaction(me.role);

  const pickFrom = (id: string) => {
    setFromId(id);
    if (id === toId) setToId(accounts.find((a) => a.id !== id)?.id ?? "");
  };

  async function save() {
    const ok = await attempt(
      () => m.saveTransfer(me.id, { transferId: transferId ?? undefined, fromAccountId: fromId, toAccountId: toId, amount, toAmount, fee, date, note }),
      transferId ? "Transfer diperbarui" : "Transfer tercatat",
    );
    if (ok) onClose();
  }

  async function remove() {
    if (!transferId || !confirm("Hapus transfer ini (kedua sisinya)?")) return;
    if (await deleteWithUndo(() => m.deleteTransfer(me.id, transferId), "Transfer dihapus", me)) onClose();
  }

  if (accounts.length < 2) {
    return (
      <div className="space-y-3">
        {modeSwitch}
        <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Butuh minimal dua akun untuk transfer. Tambahkan akun di Menu → Isi dompet.</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && allowed) save();
      }}
    >
      {modeSwitch}
      <fieldset disabled={!allowed} className="min-w-0 space-y-3">
        <AccountPicker label="Dari akun" accounts={accounts} value={fromId} onChange={pickFrom} />
        <div className="-my-1 text-center text-lg text-slate-400" aria-hidden>
          ↓
        </div>
        <AccountPicker label="Ke akun" accounts={accounts.filter((a) => a.id !== fromId)} value={toId} onChange={setToId} />

        <Field label={cross ? `Berapa? (${currencyInfo(fromCur).flag} ${fromCur})` : "Berapa?"} hint={amount > 0 ? formatMoney(amount, fromCur) : undefined}>
          <Input
            inputMode="decimal"
            placeholder={isBase(fromCur) ? "500rb" : "100.00"}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="py-2.5 text-center !text-3xl font-extrabold tracking-tight"
          />
        </Field>
        {from && amount > from.balance && <p className="-mt-2 text-xs text-amber-700">Saldo {from.name} hanya {formatMoney(from.balance, fromCur)}.</p>}
        {cross && (
          <Field
            label={`Diterima di ${to?.name ?? "tujuan"} (${currencyInfo(toCur).flag} ${toCur})`}
            hint={Number.isFinite(toAmount) && toAmount > 0 ? `${formatMoney(toAmount, toCur)}${toAmountText.trim() ? "" : " · perkiraan dari kurs akun"}` : "Isi jumlah yang masuk"}
          >
            <Input
              inputMode="decimal"
              value={toAmountText}
              placeholder={Number.isFinite(estimate) ? moneyInputText(estimate, toCur) : ""}
              onChange={(e) => setToAmountText(e.target.value)}
              className="text-center !text-xl font-bold"
            />
          </Field>
        )}

        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Biaya admin (opsional{isBase(fromCur) ? "" : `, dalam ${fromCur}`})</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFeeText("")}
              className={cx("rounded-full px-3 py-1 text-xs font-semibold", !feeText ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
            >
              Gratis
            </button>
            {(isBase(fromCur) ? QUICK_FEES : []).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFeeText(String(f))}
                className={cx("rounded-full px-3 py-1 text-xs font-semibold", fee === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
              >
                {formatCompact(f)}
              </button>
            ))}
            <Input inputMode="decimal" value={feeText} placeholder="lainnya" onChange={(e) => setFeeText(e.target.value)} className="!w-28 !py-1.5 text-sm" aria-label="Biaya admin" />
          </div>
          <p className="mt-1 text-xs text-slate-400">Biaya admin dihitung sebagai pengeluaran dari akun asal. Transfernya sendiri tidak.</p>
        </div>

        <DatePicker label="Tanggal" value={date} onChange={setDate} />
        {date > todayISO() && <p className="-mt-1 text-xs text-sky-700">Bertanggal nanti: saldo kedua akun baru berubah saat tanggalnya tiba.</p>}
        <Field label="Catatan (opsional)">
          <Input value={note} maxLength={100} placeholder="mis. Isi saldo GoPay" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </fieldset>

      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {transferId && allowed && (
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
    </form>
  );
}
