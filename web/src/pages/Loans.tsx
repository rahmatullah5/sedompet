import { useState } from "react";
import { deleteWithUndo } from "../lib/undo";
import { AccountPicker } from "../components/Pickers";
import { DatePicker } from "../components/DatePicker";
import { q } from "../db/repo";
import { mm, mq, type Loan, type LoanDirection } from "../db/money";
import { can } from "../lib/permissions";
import { formatDay, formatIDR, todayISO } from "../lib/format";
import { formatMoney, isBase, moneyInputText, parseMoney, toBase } from "../lib/currency";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Badge, Button, Card, cx, Empty, Field, Input, Modal, Progress, STICKY_ACTIONS } from "../components/ui";

export function Loans() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const loans = mq.loans(dompet.id, me.id);
  const [creating, setCreating] = useState<LoanDirection | null>(null);
  const [paying, setPaying] = useState<Loan | null>(null);
  const open = loans.filter((l) => !l.settled);
  const done = loans.filter((l) => l.settled);
  const rate = new Map(q.accounts(dompet.id, me.id).map((a) => [a.id, a.fx_rate]));
  const leftBase = (l: Loan) => toBase(l.amount - l.repaid, l.account_currency, rate.get(l.account_id));
  const owedToUs = open.filter((l) => l.direction === "lent").reduce((s, l) => s + leftBase(l), 0);
  const weOwe = open.filter((l) => l.direction === "borrowed").reduce((s, l) => s + leftBase(l), 0);
  const canAdd = can.addTransaction(me.role);

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Utang & Piutang 🤝</h1>
        <p className="text-sm text-slate-500">Catat uang yang dipinjamkan atau dipinjam, lalu cicilannya. Tidak dihitung sebagai belanja.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-mint-100">
          <p className="text-xs font-semibold text-mint-600">Orang berutang ke kita</p>
          <p className="num mt-1 text-xl font-extrabold text-slate-800">{formatIDR(owedToUs)}</p>
          {canAdd && (
            <Button variant="secondary" className="mt-3 w-full bg-white" onClick={() => setCreating("lent")}>
              + Pinjamkan
            </Button>
          )}
        </Card>
        <Card className="bg-sun-100">
          <p className="text-xs font-semibold text-amber-700">Kita berutang</p>
          <p className="num mt-1 text-xl font-extrabold text-slate-800">{formatIDR(weOwe)}</p>
          {canAdd && (
            <Button variant="secondary" className="mt-3 w-full bg-white" onClick={() => setCreating("borrowed")}>
              + Pinjam
            </Button>
          )}
        </Card>
      </div>

      {open.length === 0 ? (
        <Card>
          <Empty icon="🕊️" title="Tidak ada utang yang berjalan">
            Bebas utang itu tenang.
          </Empty>
        </Card>
      ) : (
        open.map((l) => <LoanCard key={l.id} loan={l} onPay={() => setPaying(l)} />)
      )}

      {done.length > 0 && (
        <details className="rounded-3xl bg-white/60 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Sudah lunas ({done.length})</summary>
          <div className="mt-3 space-y-3">
            {done.map((l) => (
              <LoanCard key={l.id} loan={l} />
            ))}
          </div>
        </details>
      )}

      <Modal open={creating !== null} onClose={() => setCreating(null)} title={creating === "lent" ? "Pinjamkan uang" : "Pinjam uang"}>
        {creating && <LoanForm direction={creating} onClose={() => setCreating(null)} />}
      </Modal>
      <Modal open={paying !== null} onClose={() => setPaying(null)} title={paying?.direction === "lent" ? "Terima cicilan" : "Bayar cicilan"}>
        {paying && <PaymentForm loan={paying} onClose={() => setPaying(null)} />}
      </Modal>
    </div>
  );
}

function LoanCard({ loan, onPay }: { loan: Loan; onPay?: () => void }) {
  const { me } = useCurrent();
  const left = loan.amount - loan.repaid;
  const overdue = !loan.settled && loan.due_date && loan.due_date < todayISO();
  const mine = can.editTransaction(me.role, loan.created_by === me.id);
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-slate-800">
            {loan.direction === "lent" ? `${loan.counterparty} pinjam ke kita` : `Kita pinjam ke ${loan.counterparty}`}
          </p>
          <p className="text-xs text-slate-500">
            {formatDay(loan.start_date)} · {loan.account_name}
            {loan.note && ` · ${loan.note}`}
          </p>
        </div>
        {loan.settled ? (
          <Badge tone="brand">Lunas 🎉</Badge>
        ) : overdue ? (
          <Badge tone="amber">Lewat jatuh tempo</Badge>
        ) : loan.due_date ? (
          <Badge>Jatuh tempo {formatDay(loan.due_date)}</Badge>
        ) : null}
      </div>
      <div className="mt-3">
        <Progress value={loan.repaid} max={loan.amount} colour="#2fb67c" />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="num text-slate-600">
          {formatMoney(loan.repaid, loan.account_currency)} <span className="text-slate-400">/ {formatMoney(loan.amount, loan.account_currency)}</span>
        </span>
        {!loan.settled && <span className="num font-semibold text-slate-800">sisa {formatMoney(Math.max(0, left), loan.account_currency)}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {onPay && !loan.settled && can.addTransaction(me.role) && <Button onClick={onPay}>{loan.direction === "lent" ? "Terima cicilan" : "Bayar cicilan"}</Button>}
        {mine && !loan.settled && (
          <Button variant="ghost" onClick={() => attempt(() => mm.setLoanSettled(me.id, loan.id, true), "Ditandai lunas")}>
            Tandai lunas
          </Button>
        )}
        {mine && (
          <Button
            variant="ghost"
            className="text-red-600"
            onClick={() => confirm("Hapus pinjaman ini beserta semua cicilannya?") && deleteWithUndo(() => mm.deleteLoan(me.id, loan.id), "Pinjaman dihapus", me)}
          >
            Hapus
          </Button>
        )}
      </div>
    </Card>
  );
}

function LoanForm({ direction, onClose }: { direction: LoanDirection; onClose: () => void }) {
  const { dompet, me } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id);
  const [who, setWho] = useState("");
  const [amountText, setAmountText] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "IDR";
  const amount = parseMoney(amountText, currency);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () => mm.createLoan(me.id, { direction, counterparty: who, amount, account_id: accountId, start_date: date, due_date: due || null, note }),
          "Tercatat",
        );
        if (ok) onClose();
      }}
    >
      <Field label={direction === "lent" ? "Dipinjamkan ke siapa?" : "Pinjam dari siapa?"}>
        <Input autoFocus value={who} maxLength={60} placeholder="mis. Om Budi" onChange={(e) => setWho(e.target.value)} />
      </Field>
      <Field label={isBase(currency) ? "Berapa?" : `Berapa? (${currency})`} hint={amount > 0 ? formatMoney(amount, currency) : isBase(currency) ? "Ketik 500rb atau 2jt" : "mis. 100.50"}>
        <Input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <div className="space-y-3">
        <AccountPicker label={direction === "lent" ? "Uang keluar dari" : "Uang masuk ke"} accounts={accounts} value={accountId} onChange={setAccountId} />
        <DatePicker label="Tanggal" value={date} onChange={setDate} />
      </div>
      <DatePicker label="Jatuh tempo (opsional)" value={due} min={date} onChange={setDue} optional presets="future" placeholder="Tidak ada jatuh tempo" />
      <Field label="Catatan (opsional)">
        <Input value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!(amount > 0) || !who.trim() || !accountId}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

function PaymentForm({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { dompet, me } = useCurrent();
  // Repayments stay in the loan's currency.
  const accounts = q.accounts(dompet.id, me.id).filter((a) => a.currency === loan.account_currency);
  const cur = loan.account_currency;
  const left = Math.max(0, loan.amount - loan.repaid);
  const [amountText, setAmountText] = useState(moneyInputText(left, cur));
  const [accountId, setAccountId] = useState(loan.account_id);
  const [date, setDate] = useState(todayISO());
  const amount = parseMoney(amountText, cur);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => mm.recordLoanPayment(me.id, loan.id, { amount, account_id: accountId, date }), "Cicilan tercatat")) onClose();
      }}
    >
      <p className="text-sm text-slate-500">
        Sisa {formatMoney(left, cur)} {loan.direction === "lent" ? `dari ${loan.counterparty}` : `ke ${loan.counterparty}`}.
      </p>
      <Field label="Jumlah" hint={amount > 0 ? formatMoney(amount, cur) : undefined}>
        <Input autoFocus inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {[left, Math.round(left / 2)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
          <button key={v} type="button" onClick={() => setAmountText(moneyInputText(v, cur))} className={cx("rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-brand-100")}>
            {v === left ? "Lunasi" : "Setengah"} · {formatMoney(v, cur)}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
        <DatePicker label="Tanggal" value={date} onChange={setDate} />
      </div>
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!(amount > 0)}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
