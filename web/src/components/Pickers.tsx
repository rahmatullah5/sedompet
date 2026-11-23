import { useState } from "react";
import { accountTypeIcon, q, type Account, type Category } from "../db/repo";
import { setMainAccount, useCurrent, useMainAccount } from "../lib/hooks";
import { formatCompact } from "../lib/format";
import { formatMoney, isBase } from "../lib/currency";
import { Icon } from "./Icon";
import { LineIcon } from "./LineIcon";
import { cx } from "./ui";


/**
 * Multi-select category icons for filtering. Selecting a parent includes its
 * sub-categories; picking specific sub-categories narrows to just those.
 */
export function MultiCategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const parents = categories.filter((c) => !c.parent_id);
  const subsOf = (id: string) => categories.filter((c) => c.parent_id === id);
  const has = (id: string) => value.includes(id);
  // A parent counts as "active" if it or any of its subs is selected.
  const active = (p: Category) => has(p.id) || subsOf(p.id).some((s) => has(s.id));

  const toggleParent = (p: Category) => {
    const subIds = subsOf(p.id).map((s) => s.id);
    if (active(p)) onChange(value.filter((id) => id !== p.id && !subIds.includes(id)));
    else onChange([...value, p.id]);
  };
  const toggleSub = (p: Category, s: Category) => {
    const subIds = subsOf(p.id).map((x) => x.id);
    let next = value.filter((id) => id !== p.id); // specific subs replace "all of parent"
    next = has(s.id) ? next.filter((id) => id !== s.id) : [...next, s.id];
    // No sub left selected -> fall back to the whole parent.
    if (!next.some((id) => subIds.includes(id))) next = [...next, p.id];
    onChange(next);
  };

  const withSubs = parents.filter((p) => active(p) && subsOf(p.id).length > 0);

  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {parents.map((p) => {
          const on = active(p);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggleParent(p)}
              aria-pressed={on}
              className={cx(
                "flex flex-col items-center gap-0.5 rounded-2xl border-2 px-1 py-1.5 text-[11px] font-semibold transition",
                on ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-transparent bg-slate-50 text-slate-700 hover:bg-slate-100",
              )}
            >
              <span className={cx("flex h-8 w-8 items-center justify-center rounded-xl", !on && "bg-white")} style={!on ? { background: `${p.colour}1f` } : undefined}>
                <Icon value={p.icon} size={21} />
              </span>
              <span className="line-clamp-1 w-full text-center">{p.name}</span>
            </button>
          );
        })}
      </div>
      {withSubs.map((p) => (
        <div key={p.id} className="pop-in mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl bg-brand-50 p-2">
          <span className="flex items-center gap-1 px-1 text-xs font-bold text-brand-800">
            <Icon value={p.icon} size={14} /> {p.name}:
          </span>
          <button
            type="button"
            onClick={() => onChange([...value.filter((id) => !subsOf(p.id).some((s) => s.id === id) && id !== p.id), p.id])}
            className={cx("rounded-full px-2.5 py-0.5 text-xs font-semibold", has(p.id) ? "bg-brand-600 text-white" : "bg-white text-slate-600")}
          >
            Semua
          </button>
          {subsOf(p.id).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSub(p, s)}
              aria-pressed={has(s.id)}
              className={cx(
                "inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2.5 text-xs font-semibold",
                has(s.id) ? "bg-brand-600 text-white" : "bg-white text-slate-600",
              )}
            >
              <Icon value={s.icon} size={14} /> {s.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Multi-select account chips for filtering. */
export function MultiAccountPicker({ accounts, value, onChange }: { accounts: Account[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {accounts.map((a) => {
        const on = value.includes(a.id);
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onChange(on ? value.filter((id) => id !== a.id) : [...value, a.id])}
            aria-pressed={on}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold transition",
              on ? "bg-slate-800 text-white" : "bg-white text-slate-600 shadow-sm hover:bg-slate-50",
            )}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: on ? "rgba(255,255,255,0.15)" : `${a.colour}26` }}>
              <Icon value={a.icon ?? accountTypeIcon(a.type)} size={15} />
            </span>
            {a.visibility === "private" && <LineIcon name="lock" size={12} />}
            {a.name}
          </button>
        );
      })}
    </div>
  );
}

/** Most used first (by number of transactions); ties keep their usual order. */
function byUsage<T extends { id: string }>(list: T[], usage: Map<string, number>, extra?: (x: T) => number) {
  const n = (x: T) => (usage.get(x.id) ?? 0) + (extra?.(x) ?? 0);
  return list.map((x, i) => ({ x, i })).sort((a, b) => n(b.x) - n(a.x) || a.i - b.i).map((e) => e.x);
}

/**
 * Account cards (icon, name, balance), most used first. With many accounts
 * only the first few show plus "N lainnya", like the category picker. The
 * member's "akun utama" carries a star; `mainControl` adds a link to change it.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  label = "Akun",
  mainControl,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  mainControl?: boolean;
}) {
  const { dompet, me } = useCurrent();
  const main = useMainAccount(me.id);
  const [expanded, setExpanded] = useState(false);
  const sorted = byUsage(accounts, q.usage(dompet.id));
  const LIMIT = 5;
  let shown = sorted;
  if (!expanded && sorted.length > LIMIT + 1) {
    shown = sorted.slice(0, LIMIT);
    const sel = sorted.find((a) => a.id === value);
    if (sel && !shown.includes(sel)) shown = [...shown.slice(0, LIMIT - 1), sel];
  }
  const hidden = sorted.length - shown.length;
  const tileCls = "flex min-w-0 flex-col items-start gap-0.5 rounded-2xl border-2 p-2 text-left transition";

  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {accounts.length === 0 ? (
        <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Belum ada akun. Tambahkan di Menu → Isi dompet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={label}>
          {shown.map((a) => {
            const on = a.id === value;
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(a.id)}
                className={cx(tileCls, on ? "border-brand-600 bg-brand-50 shadow-sm" : "border-transparent bg-slate-50 hover:bg-slate-100")}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${a.colour}26` }}>
                    <Icon value={a.icon ?? accountTypeIcon(a.type)} size={18} />
                  </span>
                  <span className="flex items-center gap-0.5 text-xs leading-none">
                    {main === a.id && <span title="Akun utama" className="text-amber-500"><LineIcon name="star" size={12} /></span>}
                    {a.visibility === "private" ? (
                      <LineIcon name="lock" size={12} className="text-slate-500" />
                    ) : a.holder_emoji ? (
                      <span title={`Dipegang ${a.holder_name}`} className="text-sm">
                        <span className="font-bold text-slate-500">{a.holder_name?.trim().charAt(0).toUpperCase()}</span>
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className={cx("line-clamp-1 text-xs font-semibold leading-tight", on ? "text-brand-800" : "text-slate-700")}>{a.name}</span>
                <span className="num text-[11px] text-slate-400">{isBase(a.currency) ? formatCompact(a.balance) : formatMoney(a.balance, a.currency)}</span>
              </button>
            );
          })}
          {hidden > 0 && (
            <button type="button" onClick={() => setExpanded(true)} className={cx(tileCls, "items-center justify-center border-transparent bg-slate-50 text-xs font-semibold text-slate-600 hover:bg-slate-100")}>
              <LineIcon name="plus" size={18} />
              {hidden} lainnya
            </button>
          )}
          {expanded && sorted.length > LIMIT + 1 && (
            <button type="button" onClick={() => setExpanded(false)} className={cx(tileCls, "items-center justify-center border-transparent bg-slate-50 text-xs font-semibold text-slate-600 hover:bg-slate-100")}>
              <LineIcon name="minus" size={18} />
              Ringkas
            </button>
          )}
        </div>
      )}
      {mainControl && value && (
        <p className="mt-1 px-1 text-xs text-slate-500">
          {main === value ? (
            <>
              Akun utama: otomatis terpilih tiap catat baru.{" "}
              <button type="button" className="font-semibold text-slate-600 underline" onClick={() => setMainAccount(me.id, null)}>
                Lepas
              </button>
            </>
          ) : (
            <button type="button" className="font-semibold text-brand-700" onClick={() => setMainAccount(me.id, value)}>
              Jadikan akun utama
            </button>
          )}
        </p>
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
  const { dompet } = useCurrent();
  const usage = q.usage(dompet.id);
  const subCount = (p: Category) => categories.filter((c) => c.parent_id === p.id).reduce((t, c) => t + (usage.get(c.id) ?? 0), 0);
  const parents = byUsage(categories.filter((c) => !c.parent_id), usage, subCount);
  const selected = categories.find((c) => c.id === value);
  const parent = selected ? (selected.parent_id ? categories.find((c) => c.id === selected.parent_id) : selected) : undefined;
  const subs = parent ? byUsage(categories.filter((c) => c.parent_id === parent.id), usage) : [];
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
