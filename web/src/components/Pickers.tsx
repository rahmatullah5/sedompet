import { useState } from "react";
import type { Account, AccountType, Category } from "../db/repo";
import { formatCompact } from "../lib/format";
import { Icon } from "./Icon";
import { cx } from "./ui";

const TYPE_ICON: Record<AccountType, string> = { cash: "💵", bank: "🏦", ewallet: "📱", savings: "🐷" };

/** Horizontal row of tappable account cards (icon, name, balance). */
export function AccountPicker({
  accounts,
  value,
  onChange,
  label = "Akun",
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {accounts.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Belum ada akun. Tambahkan di Menu → Isi dompet.</p>
      ) : (
        <div className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label={label}>
          {accounts.map((a) => {
            const on = a.id === value;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(a.id)}
                className={cx(
                  "flex w-32 shrink-0 snap-start flex-col items-start gap-0.5 rounded-2xl border-2 p-2 text-left transition",
                  on ? "border-brand-600 bg-brand-50 shadow-sm" : "border-transparent bg-slate-50 hover:bg-slate-100",
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${a.colour}26` }}>
                    <Icon value={a.icon ?? TYPE_ICON[a.type]} size={18} />
                  </span>
                  {a.visibility === "private" && <span className="text-xs">🔒</span>}
                </span>
                <span className={cx("line-clamp-1 text-xs font-semibold leading-tight", on ? "text-brand-800" : "text-slate-700")}>{a.name}</span>
                <span className="num text-[11px] text-slate-400">{formatCompact(a.balance)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Category icons. Tapping a parent selects it; if it has subcategories they
 * appear underneath as their own row of icons ("Semua <parent>" keeps the parent).
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  label = "Untuk apa?",
  noneLabel,
  noneIcon = "✨",
}: {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  /** When set, shows a first tile meaning "no specific category" (e.g. "Semua pengeluaran"). */
  noneLabel?: string;
  noneIcon?: string;
}) {
  const parents = categories.filter((c) => !c.parent_id);
  const selected = categories.find((c) => c.id === value);
  const parent = selected ? (selected.parent_id ? categories.find((c) => c.id === selected.parent_id) : selected) : undefined;
  const subs = parent ? categories.filter((c) => c.parent_id === parent.id) : [];
  const [expanded, setExpanded] = useState(false);
  // Show 7 tiles (+ "more"); the selected category always stays visible.
  const LIMIT = noneLabel ? 6 : 7;
  let shown = parents;
  if (!expanded && parents.length > LIMIT + 1) {
    shown = parents.slice(0, LIMIT);
    if (parent && !shown.includes(parent)) shown = [...shown.slice(0, LIMIT - 1), parent];
  }
  const hidden = parents.length - shown.length;

  const tile = (key: string, icon: string, name: string, on: boolean, onClick: () => void, colour?: string, badge?: number) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cx(
        "relative flex flex-col items-center gap-0.5 rounded-2xl border-2 px-1 py-1.5 text-[11px] font-semibold transition",
        on ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-transparent bg-slate-50 text-slate-700 hover:bg-slate-100",
      )}
    >
      <span className={cx("flex h-8 w-8 items-center justify-center rounded-xl", !on && "bg-white")} style={!on && colour ? { background: `${colour}1f` } : undefined}>
        <Icon value={icon} size={21} />
      </span>
      <span className="line-clamp-1 w-full text-center">{name}</span>
      {badge ? (
        <span className={cx("absolute right-1.5 top-1.5 rounded-full px-1.5 text-[9px] font-bold", on ? "bg-white/25" : "bg-slate-200 text-slate-500")}>{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {noneLabel && tile("none", noneIcon, noneLabel, value === null, () => onChange(null))}
        {shown.map((c) =>
          tile(c.id, c.icon, c.name, parent?.id === c.id, () => onChange(c.id), c.colour, categories.filter((s) => s.parent_id === c.id).length),
        )}
        {hidden > 0 && tile("more", "➕", `${hidden} lainnya`, false, () => setExpanded(true))}
        {expanded && parents.length > LIMIT + 1 && tile("less", "➖", "Ringkas", false, () => setExpanded(false))}
      </div>
      {parent && subs.length > 0 && (
        <div className="pop-in mt-2 rounded-2xl bg-brand-50 p-2.5">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-bold text-brand-800">
            <Icon value={parent.icon} size={14} /> {parent.name}: lebih tepatnya?
          </p>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
            {tile(`all-${parent.id}`, parent.icon, `Semua`, value === parent.id, () => onChange(parent.id), parent.colour)}
            {subs.map((s) => tile(s.id, s.icon, s.name, value === s.id, () => onChange(s.id), parent.colour))}
          </div>
        </div>
      )}
    </div>
  );
}
