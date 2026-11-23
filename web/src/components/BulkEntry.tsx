import { useState } from "react";
import { m, q, type Kind } from "../db/repo";
import { formatIDR, parseAmount, todayISO } from "../lib/format";
import { parseMoney } from "../lib/currency";
import { useCurrent, useDbVersion, getMainAccount } from "../lib/hooks";
import { attempt, Button, cx, Select, STICKY_ACTIONS, AmountInput } from "./ui";

interface Row {
  key: string;
  date: string;
  kind: Kind;
  note: string;
  amountText: string;
  categoryId: string;
  accountId: string;
  paidBy: string;
}

const inputCls = "min-w-0 rounded-xl border-2 border-transparent bg-slate-100 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:bg-white";

/**
 * "12/11 makan siang 35rb" / "+ gaji 5jt" -> rows. Date (dd/mm[/yy]) and a
 * leading "+" (income) are optional; the amount is the last number-like word.
 */
export function parsePasted(text: string, today = todayISO()) {
  const out: { date: string; kind: Kind; note: string; amount: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/^[-•*]\s*/, "");
    if (!line) continue;
    let date = today;
    const dm = line.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s+/);
    if (dm) {
      const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
      const d = new Date(y, Number(dm[2]) - 1, Number(dm[1]));
      if (d.getDate() === Number(dm[1])) date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      line = line.slice(dm[0].length);
    }
    let kind: Kind = "expense";
    if (line.startsWith("+")) {
      kind = "income";
      line = line.slice(1).trim();
    }
    const words = line.split(/\s+/);
    let amount = NaN;
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i].toLowerCase().replace(/^rp\.?/, "").replace(/^\+/, "");
      const v = parseAmount(w);
      if (Number.isFinite(v) && v > 0) {
        amount = v;
        words.splice(i, 1);
        if (words[i - 1]?.toLowerCase().replace(/\.$/, "") === "rp") words.splice(i - 1, 1);
        break;
      }
    }
    if (!Number.isFinite(amount)) continue;
    out.push({ date, kind, note: words.join(" ").trim(), amount });
  }
  return out;
}

export function BulkBody({ onClose, modeSwitch }: { onClose: () => void; modeSwitch?: React.ReactNode }) {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id).filter((a) => a.visibility === "shared" || a.owner_member_id === me.id);
  const categories = q.categories(dompet.id);
  const parents = new Map(categories.map((c) => [c.id, c]));
  const catLabel = (id: string) => {
    const c = parents.get(id);
    if (!c) return "";
    const p = c.parent_id ? parents.get(c.parent_id) : null;
    return p ? `${p.name} › ${c.name}` : c.name;
  };
  const defaultAccount = (accounts.find((a) => a.id === getMainAccount(me.id)) ?? accounts.find((a) => (a.holder_member_id ?? a.owner_member_id) === me.id) ?? accounts[0])?.id ?? "";
  // From earlier entries: the whole note first, then its words (longest first).
  const guessCategory = (note: string, kind: Kind) => {
    const words = note.trim().split(/\s+/).filter((x) => x.length >= 3).sort((a, b) => b.length - a.length);
    for (const needle of [note.trim(), ...words]) {
      if (needle.length < 2) continue;
      const hit = q.suggestions(dompet.id, me.id, needle, 1, kind)[0]?.category_id;
      if (hit) return hit;
    }
    return "";
  };
  const blank = (from?: Row): Row => ({
    key: crypto.randomUUID(),
    date: from?.date ?? todayISO(),
    kind: from?.kind ?? "expense",
    note: "",
    amountText: "",
    categoryId: "",
    accountId: from?.accountId ?? defaultAccount,
    paidBy: from?.paidBy ?? me.id,
  });
  const [rows, setRows] = useState<Row[]>(() => [blank(), blank(), blank()]);
  const [paste, setPaste] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const update = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const cur = (r: Row) => accounts.find((a) => a.id === r.accountId)?.currency ?? "IDR";
  const filled = rows.filter((r) => r.amountText.trim() || r.note.trim());
  const parsed = filled.map((r) => ({ r, amount: parseMoney(r.amountText, cur(r)) }));
  const bad = parsed.filter((x) => !(Number.isFinite(x.amount) && x.amount > 0) || !x.r.accountId);
  const out = parsed.filter((x) => x.r.kind === "expense" && x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const inn = parsed.filter((x) => x.r.kind === "income" && x.amount > 0).reduce((s, x) => s + x.amount, 0);

  function applyPaste() {
    const items = parsePasted(paste);
    if (items.length === 0) return;
    const base = rows[rows.length - 1];
    const fresh = items.map((it) => ({
      ...blank(base),
      date: it.date,
      kind: it.kind,
      note: it.note,
      amountText: String(it.amount),
      categoryId: guessCategory(it.note, it.kind),
    }));
    setRows((rs) => [...rs.filter((r) => r.amountText.trim() || r.note.trim()), ...fresh]);
    setPaste("");
    setPasteOpen(false);
  }

  async function save() {
    const ok = await attempt(
      () =>
        m.saveBulk(
          me.id,
          parsed.map(({ r, amount }) => ({
            kind: r.kind, amount, account_id: r.accountId, category_id: r.categoryId || null, date: r.date, note: r.note, paid_by: r.paidBy,
          })),
        ),
      `${parsed.length} catatan tersimpan`,
    );
    if (ok) onClose();
  }

  return (
    <div className="space-y-3">
      {modeSwitch}
      <p className="text-sm text-slate-500">Cocok untuk menyalin catatan lama atau rekap setelah liburan. Baris kosong dilewati.</p>

      {pasteOpen ? (
        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <label className="block text-xs font-medium text-slate-500" htmlFor="bulk-paste">
            Tempel catatanmu, satu baris satu transaksi
          </label>
          <textarea
            id="bulk-paste"
            rows={5}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={"12/11 makan siang 35rb\n12/11 bensin 50rb\n+ gaji 5jt"}
            className="w-full rounded-xl border-2 border-transparent bg-white p-2.5 text-sm outline-none focus:border-brand-500"
          />
          <p className="text-xs text-slate-400">Tanggal (12/11) boleh tidak ada. Awali dengan “+” untuk pemasukan. Kategori ditebak dari catatan sebelumnya.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPasteOpen(false)}>
              Batal
            </Button>
            <Button disabled={parsePasted(paste).length === 0} onClick={applyPaste}>
              Jadikan {parsePasted(paste).length || ""} baris
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setPasteOpen(true)}>
          Tempel dari catatan / WhatsApp
        </button>
      )}

      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.key} className="space-y-1.5 rounded-2xl bg-slate-50 p-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-5 text-center text-xs font-bold text-slate-400">{i + 1}</span>
              <input type="date" aria-label={`Tanggal baris ${i + 1}`} value={r.date} onChange={(e) => update(r.key, { date: e.target.value })} className={cx(inputCls, "w-36")} />
              <button
                type="button"
                aria-label={r.kind === "expense" ? "Pengeluaran, ketuk untuk pemasukan" : "Pemasukan, ketuk untuk pengeluaran"}
                onClick={() => update(r.key, { kind: r.kind === "expense" ? "income" : "expense", categoryId: "" })}
                className={cx("h-8 w-8 shrink-0 rounded-full text-base font-bold text-white", r.kind === "expense" ? "bg-brand-600" : "bg-mint-600")}
              >
                {r.kind === "expense" ? "−" : "+"}
              </button>
              <AmountInput
                inputMode="decimal"
                aria-label={`Jumlah baris ${i + 1}`}
                placeholder="25rb"
                value={r.amountText}
                onChange={(e) => update(r.key, { amountText: e.target.value })}
                className={cx(inputCls, "flex-1 text-right font-semibold")}
              />
              <button
                type="button"
                aria-label={`Hapus baris ${i + 1}`}
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            <input
              aria-label={`Catatan baris ${i + 1}`}
              placeholder="Apa ini? mis. Pasar, Bensin"
              value={r.note}
              maxLength={140}
              onChange={(e) => update(r.key, { note: e.target.value })}
              onBlur={() => !r.categoryId && update(r.key, { categoryId: guessCategory(r.note, r.kind) })}
              className={cx(inputCls, "w-full")}
            />
            <div className="grid grid-cols-3 gap-1.5">
              <Select aria-label={`Kategori baris ${i + 1}`} value={r.categoryId} onChange={(e) => update(r.key, { categoryId: e.target.value })} className="!px-2 !py-1.5 text-xs">
                <option value="">Kategori…</option>
                {categories
                  .filter((c) => c.kind === r.kind)
                  .sort((a, b) => catLabel(a.id).localeCompare(catLabel(b.id), "id"))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {catLabel(c.id)}
                    </option>
                  ))}
              </Select>
              <Select aria-label={`Akun baris ${i + 1}`} value={r.accountId} onChange={(e) => update(r.key, { accountId: e.target.value })} className="!px-2 !py-1.5 text-xs">
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.visibility === "private" ? " (pribadi)" : ""}
                  </option>
                ))}
              </Select>
              <Select aria-label={`Dibayar baris ${i + 1}`} value={r.paidBy} onChange={(e) => update(r.key, { paidBy: e.target.value })} className="!px-2 !py-1.5 text-xs">
                {members.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setRows((rs) => [...rs, blank(rs[rs.length - 1])])}>
        + Tambah baris
      </button>

      <div className={`${STICKY_ACTIONS} justify-between`}>
        <span className="text-xs text-slate-500">
          {filled.length} baris · keluar <b className="num text-slate-700">{formatIDR(out)}</b>
          {inn > 0 && (
            <>
              {" "}
              · masuk <b className="num text-slate-700">{formatIDR(inn)}</b>
            </>
          )}
          {bad.length > 0 && <span className="block font-semibold text-red-600">Isi jumlah di baris {bad.map((x) => rows.indexOf(x.r) + 1).join(", ")}</span>}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button disabled={filled.length === 0 || bad.length > 0} onClick={save}>
            Simpan {filled.length || ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

