import { useState } from "react";
import type { Category } from "../db/repo";
import { formatMoney, isBase, parseMoney } from "../lib/currency";
import { formatCompact } from "../lib/format";
import { CategoryPicker } from "./Pickers";
import { Icon } from "./Icon";
import { LineIcon } from "./LineIcon";
import { AmountInput, cx, Input } from "./ui";

export interface Line {
  key: string;
  categoryId: string | null;
  amountText: string;
}

export const newLine = (categoryId: string | null = null, amountText = ""): Line => ({ key: crypto.randomUUID(), categoryId, amountText });

/**
 * Amount per line. With a total, one empty line takes what is left ("sisa"),
 * so people only type the amounts they know.
 */
export function linesTotal(lines: Line[], currency: string, totalText = "") {
  const total = parseMoney(totalText, currency);
  const hasTotal = Number.isFinite(total) && total > 0;
  const typed = lines.map((l) => (l.amountText.trim() ? parseMoney(l.amountText, currency) : NaN));
  const blanks = lines.map((l, i) => (!l.amountText.trim() ? i : -1)).filter((i) => i >= 0);
  const typedSum = typed.reduce((t, a) => t + (Number.isFinite(a) ? a : 0), 0);
  const autoIndex = hasTotal && blanks.length === 1 ? blanks[0] : -1;
  const rest = hasTotal ? total - typedSum : NaN;
  const amounts = typed.map((a, i) => (i === autoIndex ? rest : a));
  const sum = amounts.reduce((t, a) => t + (Number.isFinite(a) ? a : 0), 0);
  const allPositive = amounts.every((a) => Number.isFinite(a) && a > 0);
  const matches = !hasTotal || sum === total;
  const ok = allPositive && matches;
  return { ok, total: ok ? sum : NaN, amounts, autoIndex, rest, hasTotal, totalValue: total, sum };
}

/** One entry spread over several categories, e.g. groceries + household + admin fee. */
export function CategoryLines({
  lines,
  setLines,
  categories,
  currency,
  totalText,
  setTotalText,
}: {
  lines: Line[];
  setLines: (l: Line[]) => void;
  categories: Category[];
  currency: string;
  totalText: string;
  setTotalText: (v: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(() => lines.find((l) => !l.categoryId)?.key ?? null);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const update = (key: string, p: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const info = linesTotal(lines, currency, totalText);
  const other = categories.find((c) => !c.parent_id && /lain/i.test(c.name))?.id ?? null;
  const fmt = (n: number) => formatMoney(n, currency);
  const over = info.hasTotal && Number.isFinite(info.rest) && info.rest < 0;
  const left = info.hasTotal ? info.totalValue - info.sum : 0;

  const add = (categoryId: string | null = null, amountText = "") => {
    const l = newLine(categoryId, amountText);
    setLines([...lines, l]);
    if (!categoryId) setOpenKey(l.key);
  };

  return (
    <div className="space-y-3">
      <div>
        <span className="mb-1 block text-sm font-semibold text-slate-700">Total{isBase(currency) ? "" : ` (${currency})`}</span>
        <Input
          inputMode="decimal"
          placeholder={isBase(currency) ? "mis. 250rb" : "12,50"}
          value={totalText}
          onChange={(e) => setTotalText(e.target.value)}
          className="py-2 text-center !text-2xl font-extrabold tracking-tight"
        />
        <p className="mt-1 text-xs text-slate-400">Isi totalnya, lalu jumlah per kategori. Satu baris yang dikosongkan otomatis dapat sisanya.</p>
      </div>

      <ul className="space-y-2">
        {lines.map((l, i) => {
          const cat = l.categoryId ? byId.get(l.categoryId) : undefined;
          const parent = cat?.parent_id ? byId.get(cat.parent_id) : undefined;
          const open = openKey === l.key;
          const auto = i === info.autoIndex;
          return (
            <li key={l.key} className={cx("rounded-3xl bg-slate-50 p-2 transition", open && "ring-2 ring-brand-200")}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : l.key)}
                  aria-expanded={open}
                  aria-label={`Kategori baris ${i + 1}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-2xl bg-white px-1.5 py-1.5 text-left shadow-[0_4px_14px_-10px_rgba(120,72,40,0.35)]"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100"
                    style={cat?.colour || parent?.colour ? { background: `${cat?.colour ?? parent?.colour}1f` } : undefined}
                  >
                    {cat ? <Icon value={cat.icon || parent?.icon || "🏷️"} size={20} /> : <LineIcon name="tag" size={18} className="text-slate-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    {cat ? (
                      <>
                        <span className="block truncate text-sm font-bold text-slate-800">{cat.name}</span>
                        {parent && <span className="block truncate text-[11px] text-slate-400">{parent.name}</span>}
                      </>
                    ) : (
                      <span className="block truncate text-sm font-semibold text-brand-700">Pilih kategori</span>
                    )}
                  </span>
                  
                </button>
                <AmountInput
                  inputMode="decimal"
                  aria-label={`Jumlah baris ${i + 1}`}
                  placeholder={auto && Number.isFinite(info.rest) ? (info.rest > 0 ? `sisa ${isBase(currency) ? formatCompact(info.rest) : formatMoney(info.rest, currency)}` : "0") : "0"}
                  value={l.amountText}
                  onChange={(e) => update(l.key, { amountText: e.target.value })}
                  className={cx(
                    "w-[6.5rem] shrink-0 rounded-2xl border-2 border-transparent bg-white px-3 py-2.5 text-right text-sm font-bold outline-none focus:border-brand-500",
                    auto && "placeholder:font-semibold placeholder:text-brand-700",
                  )}
                />
                <button
                  type="button"
                  aria-label={`Hapus baris ${i + 1}`}
                  disabled={lines.length <= 2}
                  onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                  className="flex h-8 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white disabled:hidden"
                >
                  <LineIcon name="trash" size={16} />
                </button>
              </div>
              {open && (
                <div className="px-1 pb-1 pt-3">
                  <CategoryPicker
                    categories={categories}
                    value={l.categoryId}
                    label="Kategori"
                    onChange={(id) => {
                      update(l.key, { categoryId: id });
                      // Close once a category without subcategories (or a subcategory) is picked.
                      const c = id ? byId.get(id) : undefined;
                      if (c && (c.parent_id || !categories.some((s) => s.parent_id === c.id))) setOpenKey(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => add()} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-1.5 text-sm font-semibold text-brand-800 hover:bg-brand-100">
          <LineIcon name="plus" size={15} /> Tambah kategori
        </button>
        <button type="button" onClick={() => add(other, "2500")} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200">
          <LineIcon name="receipt" size={15} /> Biaya admin
        </button>
      </div>

      <div
        className={cx(
          "flex items-center justify-between rounded-2xl px-3 py-2 text-sm",
          over || (info.hasTotal && left !== 0 && info.autoIndex < 0) ? "bg-red-50 text-red-700" : "bg-mint-50 text-slate-600",
        )}
      >
        <span>
          {!info.hasTotal
            ? "Total dihitung dari semua baris"
            : over
              ? `Lebih ${fmt(-info.rest)} dari total`
              : info.autoIndex >= 0 || left === 0
                ? "Pas dengan total"
                : left > 0
                  ? `Belum terbagi ${fmt(left)}`
                  : `Lebih ${fmt(-left)} dari total`}
        </span>
        <b className="num text-slate-800">{Number.isFinite(info.total) ? fmt(info.total) : info.hasTotal ? fmt(info.totalValue) : "—"}</b>
      </div>
    </div>
  );
}
