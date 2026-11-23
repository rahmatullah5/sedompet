import { useState } from "react";
import { splitEqually, type Member, type SplitShare } from "../db/repo";
import { formatMoney, moneyInputText, parseMoney } from "../lib/currency";
import { Avatar, cx } from "./ui";

export interface SplitState {
  on: boolean;
  members: string[];
  mode: "equal" | "custom";
  custom: Record<string, string>;
}

export function initialSplit(shares: SplitShare[] | null, members: Member[], amount: number, currency: string): SplitState {
  if (!shares) return { on: false, members: members.filter((m) => m.role !== "viewer").map((m) => m.id), mode: "equal", custom: {} };
  const ids = shares.map((s) => s.m);
  const equal = JSON.stringify(splitEqually(amount, ids)) === JSON.stringify(shares);
  return {
    on: true,
    members: ids,
    mode: equal ? "equal" : "custom",
    custom: Object.fromEntries(shares.map((s) => [s.m, moneyInputText(s.a, currency)])),
  };
}

/** Shares for the current state, or an error message when they don't add up. */
export function computeSplit(st: SplitState, amount: number, currency: string): { shares: SplitShare[] | null; error: string | null } {
  if (!st.on) return { shares: null, error: null };
  if (st.members.length === 0) return { shares: null, error: "Pilih siapa saja yang ikut patungan." };
  if (!Number.isFinite(amount) || amount <= 0) return { shares: null, error: null };
  if (st.mode === "equal") return { shares: splitEqually(amount, st.members), error: null };
  const shares = st.members.map((m) => ({ m, a: parseMoney(st.custom[m] ?? "", currency) }));
  if (shares.some((s) => !Number.isFinite(s.a) || s.a <= 0)) return { shares: null, error: "Isi bagian setiap orang." };
  const sum = shares.reduce((t, s) => t + s.a, 0);
  if (sum !== amount) {
    const diff = amount - sum;
    return { shares: null, error: diff > 0 ? `Masih kurang ${formatMoney(diff, currency)}.` : `Kelebihan ${formatMoney(-diff, currency)}.` };
  }
  return { shares, error: null };
}

/** "Patungan?" toggle with members and equal / custom shares. */
export function SplitEditor({
  value,
  onChange,
  members,
  amount,
  currency,
  payerId,
}: {
  value: SplitState;
  onChange: (v: SplitState) => void;
  members: Member[];
  amount: number;
  currency: string;
  payerId: string;
}) {
  const [touched, setTouched] = useState(false);
  const { error } = computeSplit(value, amount, currency);
  const set = (p: Partial<SplitState>) => onChange({ ...value, ...p });
  const toggleMember = (id: string) => set({ members: value.members.includes(id) ? value.members.filter((x) => x !== id) : [...value.members, id] });
  const each = value.members.length && amount > 0 ? Math.floor(amount / value.members.length) : 0;
  const payer = members.find((m) => m.id === payerId);

  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-bold text-slate-800">Patungan / dibagi</span>
          <span className="block text-xs text-slate-500">Dibayar {payer?.name ?? "satu orang"}, ditanggung bersama. Sedompet mencatat siapa utang ke siapa.</span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 shrink-0 accent-[var(--color-brand-600)]"
          checked={value.on}
          onChange={(e) => set({ on: e.target.checked })}
        />
      </label>

      {value.on && (
        <div className="mt-3 space-y-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">Untuk siapa saja?</span>
            <div className="flex flex-wrap gap-1.5">
              {members.map((mem) => {
                const on = value.members.includes(mem.id);
                return (
                  <button
                    key={mem.id}
                    type="button"
                    onClick={() => (toggleMember(mem.id), setTouched(true))}
                    aria-pressed={on}
                    className={cx(
                      "flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-3 text-sm transition",
                      on ? "border-brand-600 bg-brand-50 font-medium ring-1 ring-brand-600" : "border-slate-200 bg-white text-slate-500",
                    )}
                  >
                    <Avatar emoji={mem.emoji} colour={mem.colour} size={24} />
                    {mem.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 text-sm font-bold">
            {(["equal", "custom"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => set({ mode })}
                className={cx("rounded-full py-1.5 transition", value.mode === mode ? "bg-slate-800 text-white" : "text-slate-500")}
              >
                {mode === "equal" ? "Sama rata" : "Atur sendiri"}
              </button>
            ))}
          </div>

          {value.mode === "equal" ? (
            <p className="text-sm text-slate-600">
              {value.members.length > 0 && amount > 0 ? (
                <>
                  <b className="num">{formatMoney(each, currency)}</b> per orang × {value.members.length} orang
                </>
              ) : (
                "Isi jumlah dan pilih orangnya."
              )}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {members
                .filter((m) => value.members.includes(m.id))
                .map((mem) => (
                  <li key={mem.id} className="flex items-center gap-2">
                    <Avatar emoji={mem.emoji} colour={mem.colour} size={26} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{mem.name}</span>
                    <input
                      inputMode="decimal"
                      aria-label={`Bagian ${mem.name}`}
                      className="w-32 rounded-xl border-2 border-transparent bg-white px-3 py-1.5 text-right text-sm font-semibold outline-none focus:border-brand-500"
                      placeholder="0"
                      value={value.custom[mem.id] ?? ""}
                      onChange={(e) => (set({ custom: { ...value.custom, [mem.id]: e.target.value } }), setTouched(true))}
                    />
                  </li>
                ))}
            </ul>
          )}
          {error && (touched || value.mode === "custom") && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
