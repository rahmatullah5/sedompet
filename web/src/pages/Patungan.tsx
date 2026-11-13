import { useState } from "react";
import { m, q, settleUp, type Transaction } from "../db/repo";
import { can } from "../lib/permissions";
import { formatIDR, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Button, Card, cx, Empty, Field, Input, Modal, STICKY_ACTIONS } from "../components/ui";
import { AccountPicker } from "../components/Pickers";
import { DatePicker } from "../components/DatePicker";
import { moneyInputText, parseMoney } from "../lib/currency";
import { TxRow } from "./Transactions";

/** Ignore rounding leftovers of a rupiah or so. */
const SETTLED = 1;

/**
 * Patungan: who paid for shared (split) expenses, who owes whom, and the
 * fewest payments to settle everyone.
 */
export function Patungan({ onOpenTx }: { onOpenTx: (t: Transaction) => void }) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const balances = q.splitBalances(dompet.id);
  const plan = settleUp(balances.map((b) => ({ id: b.id, net: Math.abs(b.net) <= SETTLED ? 0 : b.net })));
  const history = q.transactions(dompet.id, me.id).filter((t) => t.split_with).slice(0, 30);
  const [settling, setSettling] = useState<{ from: string; to: string; amount: number } | null>(null);
  const byId = new Map(members.map((x) => [x.id, x]));
  const any = balances.some((b) => b.paid || b.owed || b.sent || b.received);

  return (
    <div className="space-y-5">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Patungan 👥</h1>
        <p className="text-sm text-slate-500">Satu orang bayar, ditanggung bersama. Di sini kelihatan siapa masih utang ke siapa.</p>
      </div>

      {!any ? (
        <Card>
          <Empty icon="🧾" title="Belum ada patungan">
            Saat mencatat pengeluaran dari akun bersama, nyalakan <b>👥 Patungan / dibagi</b> lalu pilih siapa saja yang ikut. Cocok untuk kos bareng, trip, atau
            belanja bulanan berdua.
          </Empty>
        </Card>
      ) : (
        <>
          <Card title="Cara melunasi">
            {plan.length === 0 ? (
              <p className="py-2 text-center font-semibold text-mint-600">✅ Semua sudah lunas!</p>
            ) : (
              <ul className="space-y-2">
                {plan.map((p) => {
                  const from = byId.get(p.from);
                  const to = byId.get(p.to);
                  return (
                    <li key={p.from + p.to} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-slate-50 p-3">
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <span className="flex shrink-0 -space-x-1.5">
                          <Avatar emoji={from?.emoji ?? "👤"} colour={from?.colour ?? "#94a3b8"} size={30} />
                          <Avatar emoji={to?.emoji ?? "👤"} colour={to?.colour ?? "#94a3b8"} size={30} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-bold text-slate-800">
                            {from?.name} → {to?.name}
                          </span>
                          <span className="num block font-extrabold text-slate-800">{formatIDR(p.amount)}</span>
                        </span>
                      </span>
                      {can.addTransaction(me.role) && (
                        <Button variant="secondary" className="px-3 py-1.5" onClick={() => setSettling(p)}>
                          Catat lunas
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Saldo patungan">
            <ul className="divide-y divide-slate-100">
              {balances
                .filter((b) => b.paid || b.owed || b.sent || b.received)
                .sort((a, b) => b.net - a.net)
                .map((b) => {
                  const zero = Math.abs(b.net) <= SETTLED;
                  return (
                    <li key={b.id} className="flex items-center gap-3 py-3">
                      <Avatar emoji={b.emoji} colour={b.colour} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800">
                          {b.name}
                          {b.id === me.id && <span className="text-xs font-semibold text-slate-400"> (kamu)</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          Membayar {formatIDR(b.paid)} · bagiannya {formatIDR(b.owed)}
                          {b.sent > 0 && ` · sudah melunasi ${formatIDR(b.sent)}`}
                          {b.received > 0 && ` · sudah diterima ${formatIDR(b.received)}`}
                        </p>
                      </div>
                      <span className={cx("num text-right text-sm font-bold", zero ? "text-slate-400" : b.net > 0 ? "text-mint-600" : "text-red-600")}>
                        {zero ? "Lunas ✓" : b.net > 0 ? `+${formatIDR(b.net)}` : `−${formatIDR(-b.net)}`}
                        <span className="block text-[11px] font-semibold text-slate-400">{zero ? "" : b.net > 0 ? "dapat kembali" : "perlu bayar"}</span>
                      </span>
                    </li>
                  );
                })}
            </ul>
          </Card>

          <Card title="Riwayat patungan">
            <ul className="-mx-2">
              {history.map((t) => (
                <TxRow key={t.id} t={t} showDate onClick={() => onOpenTx(t)} />
              ))}
            </ul>
          </Card>
        </>
      )}

      {settling && <SettleSheet settle={settling} onClose={() => setSettling(null)} />}
    </div>
  );
}

function SettleSheet({ settle, onClose }: { settle: { from: string; to: string; amount: number }; onClose: () => void }) {
  const { dompet, me, members } = useCurrent();
  const shared = q.accounts(dompet.id, me.id).filter((a) => a.visibility === "shared");
  const held = (memberId: string) => shared.find((a) => a.holder_member_id === memberId)?.id;
  const [fromId, setFromId] = useState(held(settle.from) ?? shared[0]?.id ?? "");
  const [toId, setToId] = useState(held(settle.to) ?? held(settle.from) ?? shared[0]?.id ?? "");
  const currency = shared.find((a) => a.id === fromId)?.currency ?? "IDR";
  const [amountText, setAmountText] = useState(moneyInputText(settle.amount, "IDR"));
  const [date, setDate] = useState(todayISO());
  const amount = parseMoney(amountText, currency);
  const debtor = members.find((x) => x.id === settle.from);
  const creditor = members.find((x) => x.id === settle.to);
  const valid = Number.isFinite(amount) && amount > 0 && fromId && toId;

  async function save() {
    const ok = await attempt(
      () =>
        m.saveTransfer(me.id, {
          fromAccountId: fromId,
          toAccountId: toId,
          amount,
          fee: 0,
          date,
          note: "",
          settle: { debtor: settle.from, creditor: settle.to },
        }),
      "Pelunasan tercatat 🤝",
    );
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${debtor?.name} bayar ke ${creditor?.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save();
        }}
      >
        <Field label="Berapa?" hint="Bisa dicicil: isi sebagian saja kalau belum lunas semua.">
          <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="text-center !text-2xl font-extrabold" />
        </Field>
        {shared.length === 0 ? (
          <p className="text-sm text-red-600">Butuh minimal satu akun bersama untuk mencatat pelunasan.</p>
        ) : (
          <>
            <AccountPicker accounts={shared} value={fromId} onChange={setFromId} label={`Dari akun (${debtor?.name})`} />
            <AccountPicker accounts={shared} value={toId} onChange={setToId} label={`Ke akun (${creditor?.name})`} />
            <p className="text-xs text-slate-500">Dibayar tunai atau di luar aplikasi? Pilih akun yang sama di kedua sisi, saldonya tidak berubah.</p>
          </>
        )}
        <DatePicker label="Tanggal" value={date} onChange={setDate} />
        <div className={`${STICKY_ACTIONS} justify-end`}>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={!valid}>
            Catat lunas
          </Button>
        </div>
      </form>
    </Modal>
  );
}
