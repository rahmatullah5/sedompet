import type { Category } from "../db/repo";
import { formatMoney, parseMoney } from "../lib/currency";
import { Select, AmountInput } from "./ui";

export interface Line {
  key: string;
  categoryId: string | null;
  amountText: string;
}

export const newLine = (categoryId: string | null = null, amountText = ""): Line => ({ key: crypto.randomUUID(), categoryId, amountText });

export function linesTotal(lines: Line[], currency: string) {
  const amounts = lines.map((l) => parseMoney(l.amountText, currency));
  const ok = amounts.every((a) => Number.isFinite(a) && a > 0);
  return { ok, total: ok ? amounts.reduce((t, a) => t + a, 0) : NaN, amounts };
}

/** One entry spread over several categories, e.g. groceries + household + admin fee. */
export function CategoryLines({
  lines,
  setLines,
  categories,
  currency,
}: {
  lines: Line[];
  setLines: (l: Line[]) => void;
  categories: Category[];
  currency: string;
}) {
  const parents = new Map(categories.map((c) => [c.id, c]));
  const label = (c: Category) => (c.parent_id && parents.get(c.parent_id) ? `${parents.get(c.parent_id)!.icon} ${parents.get(c.parent_id)!.name} › ${c.name}` : `${c.icon} ${c.name}`);
  const sorted = [...categories].sort((a, b) => label(a).localeCompare(label(b), "id"));
  const update = (key: string, p: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const { ok, total } = linesTotal(lines, currency);
  const other = categories.find((c) => !c.parent_id && /lain/i.test(c.name))?.id ?? null;

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium text-slate-500">Rincian per kategori</span>
      {lines.map((l, i) => (
        <div key={l.key} className="flex items-center gap-2">
          <Select
            className="min-w-0 flex-1 !py-2 text-sm"
            aria-label={`Kategori baris ${i + 1}`}
            value={l.categoryId ?? ""}
            onChange={(e) => update(l.key, { categoryId: e.target.value || null })}
          >
            <option value="">Tanpa kategori</option>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c)}
              </option>
            ))}
          </Select>
          <AmountInput
            inputMode="decimal"
            aria-label={`Jumlah baris ${i + 1}`}
            placeholder="0"
            value={l.amountText}
            onChange={(e) => update(l.key, { amountText: e.target.value })}
            className="w-28 rounded-2xl border-2 border-transparent bg-slate-100 px-3 py-2 text-right text-sm font-semibold outline-none focus:border-brand-500 focus:bg-white"
          />
          <button
            type="button"
            aria-label={`Hapus baris ${i + 1}`}
            disabled={lines.length <= 2}
            onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 disabled:opacity-30"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setLines([...lines, newLine()])}>
          + Tambah baris
        </button>
        <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setLines([...lines, newLine(other, "2500")])}>
          + Biaya admin
        </button>
        <span className="ml-auto text-sm text-slate-500">
          Total <b className="num text-slate-800">{ok ? formatMoney(total, currency) : "—"}</b>
        </span>
      </div>
    </div>
  );
}
