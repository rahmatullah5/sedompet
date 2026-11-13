import { useMemo, useState } from "react";
import { deleteWithUndo } from "../lib/undo";
import { m, parseSplit, q, type Kind, type Transaction } from "../db/repo";
import { computeSplit, initialSplit, SplitEditor, type SplitState } from "./SplitEditor";
import { receiptValue, TxDetails, type PhotoDraft } from "./TxDetails";
import { CategoryLines, linesTotal, newLine, type Line } from "./CategoryLines";
import { can } from "../lib/permissions";
import { formatCompact, todayISO } from "../lib/format";
import { currencyInfo, formatMoney, isBase, moneyInputText, parseMoney } from "../lib/currency";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Button, cx, Field, Input, Modal, STICKY_ACTIONS } from "./ui";
import { DatePicker } from "./DatePicker";
import { AccountPicker, CategoryPicker } from "./Pickers";
import { TransferBody } from "./TransferForm";
import { BulkBody } from "./BulkEntry";
import { SuggestionList, type Suggestion } from "./Suggestions";

const QUICK = [10_000, 25_000, 50_000, 100_000];

export function TransactionForm({
  open,
  onClose,
  editing,
  initialDate,
  bulk,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Transaction | null;
  initialDate?: string;
  /** Open straight in "Catat banyak sekaligus". */
  bulk?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={editing ? "Ubah transaksi" : "Catat transaksi"}>
      {/* Remount per transaction so the form starts from fresh values. */}
      {open && <SheetBody key={editing?.id ?? `new${initialDate ?? ""}${bulk ? "bulk" : ""}`} onClose={onClose} editing={editing ?? null} initialDate={initialDate} bulk={bulk} />}
    </Modal>
  );
}

const MODES: { key: Kind | "transfer"; label: string }[] = [
  { key: "expense", label: "Pengeluaran" },
  { key: "income", label: "Pemasukan" },
  { key: "transfer", label: "Transfer" },
];

/** Pengeluaran / Pemasukan / Transfer switch at the top of the sheet. */
export function ModeSwitch({ value, onPick }: { value: Kind | "transfer"; onPick: (k: Kind | "transfer") => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1">
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => onPick(m.key)}
          className={cx(
            "rounded-full py-2 text-sm font-bold transition",
            value === m.key
              ? m.key === "expense"
                ? "bg-brand-600 text-white shadow-sm"
                : m.key === "income"
                  ? "bg-mint-600 text-white shadow-sm"
                  : "bg-slate-800 text-white shadow-sm"
              : "text-slate-500",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Chooses between the normal transaction form and the transfer form. */
function SheetBody({ onClose, editing, initialDate, bulk }: { onClose: () => void; editing: Transaction | null; initialDate?: string; bulk?: boolean }) {
  const [mode, setMode] = useState<Kind | "transfer" | "bulk">(editing?.transfer_id ? "transfer" : (editing?.kind ?? (bulk ? "bulk" : "expense")));
  if (mode === "bulk") {
    return (
      <BulkBody
        onClose={onClose}
        modeSwitch={
          <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setMode("expense")}>
            ← Catat satu saja
          </button>
        }
      />
    );
  }
  if (mode === "transfer") {
    return <TransferBody transferId={editing?.transfer_id} onClose={onClose} modeSwitch={!editing && <ModeSwitch value="transfer" onPick={setMode} />} />;
  }
  return (
    <FormBody
      key={mode}
      onClose={onClose}
      editing={editing}
      initialKind={mode}
      initialDate={initialDate}
      onPickMode={editing ? undefined : setMode}
      onBulk={editing ? undefined : () => setMode("bulk")}
    />
  );
}

function FormBody({
  onClose,
  editing,
  initialKind,
  initialDate,
  onPickMode,
  onBulk,
}: {
  onClose: () => void;
  editing: Transaction | null;
  initialKind: Kind;
  initialDate?: string;
  onBulk?: () => void;
  onPickMode?: (k: Kind | "transfer") => void;
}) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id).filter((a) => a.visibility === "shared" || a.owner_member_id === me.id);

  const [kind, setKind] = useState<Kind>(editing?.kind ?? initialKind);
  const [amountText, setAmountText] = useState(editing ? moneyInputText(editing.amount, editing.account_currency) : "");
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
  const [date, setDate] = useState(editing?.date ?? initialDate ?? todayISO());
  const [note, setNote] = useState(editing?.note ?? "");
  const [need, setNeed] = useState<"need" | "want" | null>(editing?.need ?? null);
  const [merchant, setMerchant] = useState(editing?.merchant ?? "");
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  // Suggestions only while typing a new entry (not when opening an existing one).
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestions = showSuggest && !editing ? q.suggestions(dompet.id, me.id, note) : [];
  // Fill the form from an earlier transaction; date stays as chosen.
  const applySuggestion = (s: Suggestion) => {
    setNote(s.note);
    setKind(s.kind);
    setAmountText(moneyInputText(s.amount, accounts.find((a) => a.id === s.account_id)?.currency));
    setCategoryId(s.category_id);
    if (s.merchant) setMerchant(s.merchant);
    if (s.need) setNeed(s.need);
    if (accounts.some((a) => a.id === s.account_id)) setAccountId(s.account_id);
    if (s.paid_by && members.some((m) => m.id === s.paid_by)) {
      setPaidBy(s.paid_by);
      setPayerTouched(true);
    }
    setShowSuggest(false);
  };

  const categories = q.categories(dompet.id, kind);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "IDR";
  const multi = !editing && lines !== null;
  const linesInfo = multi ? linesTotal(lines!, currency) : null;
  const amount = multi ? linesInfo!.total : parseMoney(amountText, currency);
  const isMine = !editing || editing.created_by === me.id;
  const allowed = editing ? can.editTransaction(me.role, isMine, editing.account_holder_id === me.id) : can.addTransaction(me.role);

  const selectedAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const [split, setSplit] = useState<SplitState>(() =>
    initialSplit(parseSplit(editing?.split_with), members, editing?.amount ?? 0, editing?.account_currency ?? "IDR"),
  );
  const canSplit = kind === "expense" && selectedAccount?.visibility === "shared" && members.length > 1 && !multi;
  const splitResult = computeSplit(canSplit ? split : { ...split, on: false }, amount, currency);
  const valid = Number.isFinite(amount) && amount > 0 && accountId && !(canSplit && split.on && !splitResult.shares);

  async function save() {
    const ok = await attempt(
      async () =>
        m.saveTransaction(me.id, {
          id: editing?.id,
          kind,
          amount,
          account_id: accountId,
          category_id: categoryId,
          date,
          note,
          paid_by: paidBy,
          split: splitResult.shares,
          need: kind === "expense" ? need : null,
          merchant,
          receipt: await receiptValue(dompet.id, editing?.receipt ?? null, photo, photoRemoved),
          lines: multi ? lines!.map((l, i) => ({ category_id: l.categoryId, amount: linesInfo!.amounts[i] })) : undefined,
        }),
      editing ? "Transaksi diperbarui" : "Tercatat! Keluarga bisa langsung lihat.",
    );
    if (ok) onClose();
  }

  async function remove() {
    if (!editing || !confirm("Hapus transaksi ini?")) return;
    if (await deleteWithUndo(() => m.deleteTransaction(me.id, editing.id), "Transaksi dihapus", me)) onClose();
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
        <ModeSwitch
          value={kind}
          onPick={(k) => {
            if (k === "transfer") {
              // Editing a normal entry can't turn it into a transfer.
              if (onPickMode) onPickMode("transfer");
              return;
            }
            setKind(k);
            setCategoryId(null);
            setLines(null);
          }}
        />
        {onBulk && (
          <button type="button" onClick={onBulk} className="-mt-1 text-xs font-semibold text-brand-700">
            📋 Catat banyak sekaligus
          </button>
        )}

        <div className="relative">
          <Field label="Apa ini?">
            <Input
              value={note}
              maxLength={140}
              autoComplete="off"
              placeholder="mis. Aqua, Bensin, Pasar"
              onChange={(e) => {
                setNote(e.target.value);
                setShowSuggest(true);
              }}
              onKeyDown={(e) => e.key === "Escape" && setShowSuggest(false)}
            />
          </Field>
          {showSuggest && <SuggestionList items={suggestions} onPick={applySuggestion} />}
        </div>

        {multi ? (
          <CategoryLines lines={lines!} setLines={setLines} categories={categories} currency={currency} />
        ) : (
        <>
        <Field label={isBase(currency) ? "Berapa?" : `Berapa? (${currencyInfo(currency).flag} ${currency})`} hint={Number.isFinite(amount) && amount > 0 ? formatMoney(amount, currency) : undefined}>
          <Input
            inputMode="decimal"
            placeholder={isBase(currency) ? "25rb" : "12.50"}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="py-2.5 text-center !text-3xl font-extrabold tracking-tight"
          />
        </Field>
        <div className={isBase(currency) ? "-mt-2 flex flex-wrap justify-center gap-1.5" : "hidden"}>
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
        </>
        )}
        {!editing && kind === "expense" && !split.on && (
          <button
            type="button"
            className="text-sm font-semibold text-brand-700"
            onClick={() => setLines(multi ? null : [newLine(categoryId, amountText), newLine()])}
          >
            {multi ? "← Satu kategori saja" : "➗ Pecah ke beberapa kategori"}
          </button>
        )}

        <div className="space-y-3">
          <AccountPicker accounts={accounts} value={accountId} onChange={pickAccount} />
          <DatePicker label="Tanggal" value={date} onChange={setDate} />
          {date > todayISO() && (
            <p className="-mt-1 text-xs text-sky-700">
              🗓️ Bertanggal nanti: sudah masuk catatan & anggaran bulan itu, tapi saldo akun baru berubah saat tanggalnya tiba.
            </p>
          )}
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

        {canSplit && <SplitEditor value={split} onChange={setSplit} members={members} amount={amount} currency={currency} payerId={paidBy} />}

        <TxDetails
          kind={kind}
          need={need}
          setNeed={setNeed}
          merchant={merchant}
          setMerchant={setMerchant}
          merchants={q.merchants(dompet.id)}
          existingReceipt={editing?.receipt ?? null}
          photo={photo}
          setPhoto={setPhoto}
          removed={photoRemoved}
          setRemoved={setPhotoRemoved}
        />

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
