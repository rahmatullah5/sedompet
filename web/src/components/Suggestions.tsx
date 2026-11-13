import type { q } from "../db/repo";
import { formatCompact } from "../lib/format";
import { formatMoney, isBase } from "../lib/currency";
import { Icon } from "./Icon";
import { cx } from "./ui";

export type Suggestion = ReturnType<typeof q.suggestions>[number];

/** "Pakai dari sebelumnya": earlier transactions to fill a form from. */
export function SuggestionList({ items, onPick }: { items: Suggestion[]; onPick: (s: Suggestion) => void }) {
  if (items.length === 0) return null;
  return (
    <ul
      className="pop-in mt-1.5 overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_-12px_rgba(120,72,40,0.35)] ring-1 ring-slate-100"
      role="listbox"
      aria-label="Transaksi sebelumnya"
    >
      <li className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pakai dari sebelumnya</li>
      {items.map((s) => (
        <li key={`${s.note}|${s.category_id}|${s.account_id}`}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(s)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <Icon value={s.category_icon ?? "📦"} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-800">{s.note}</span>
              <span className="block truncate text-xs text-slate-500">
                {s.category_name ?? "Tanpa kategori"} · {s.account_visibility === "private" ? "🔒 " : ""}
                {s.account_name}
                {s.paid_by_name ? ` · ${s.paid_by_name}` : ""}
                {s.uses > 1 ? ` · ${s.uses}×` : ""}
              </span>
            </span>
            <span className={cx("num shrink-0 text-sm font-bold", s.kind === "income" ? "text-mint-600" : "text-slate-800")}>
              {isBase(s.account_currency) ? formatCompact(s.amount) : formatMoney(s.amount, s.account_currency)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
