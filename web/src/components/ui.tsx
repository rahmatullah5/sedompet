import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatMoney } from "../lib/currency";
import { editTyped, groupTyped } from "../lib/format";
import { LineIcon } from "./LineIcon";
import { Icon } from "./Icon";

/** Save/cancel row that stays pinned to the bottom of a scrolling sheet. */
export const STICKY_ACTIONS =
  "sticky -bottom-6 z-10 -mx-6 mt-1 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white/95 px-6 py-3 backdrop-blur";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgba(120,72,40,0.06),0_8px_24px_-12px_rgba(120,72,40,0.18)]", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold text-slate-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-brand-600 text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
    secondary: "bg-brand-50 text-brand-800 hover:bg-brand-100",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-50 text-red-700 hover:bg-red-100",
  };
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-2xl border-2 border-transparent bg-slate-100 px-4 py-2.5 text-[15px] outline-none transition focus:border-brand-500 focus:bg-white";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  if (props.inputMode === "decimal") return <AmountInput {...props} className={cx(inputClass, props.className)} />;
  return <input {...props} className={cx(inputClass, props.className)} />;
}

/**
 * A text box for amounts that shows thousand separators while typing
 * ("1.500.000"). The parent's onChange receives the grouped text.
 */
export function AmountInput({ value, onChange, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const shown = groupTyped(String(value ?? ""));
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  return (
    <input
      {...rest}
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      value={shown}
      onChange={(e) => {
        const el = e.target;
        const next = editTyped(shown, el.value, el.selectionStart ?? el.value.length);
        el.value = next.text;
        caret.current = next.caret;
        el.setSelectionRange(next.caret, next.caret);
        onChange?.(e);
      }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputClass, "pr-8", props.className)} />;
}

export function Avatar({ emoji, colour, size = 32, title }: { emoji: string; colour: string; size?: number; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: `${colour}26`, boxShadow: `0 0 0 2px #fff, 0 0 0 ${size >= 40 ? 4 : 3}px ${colour}`, color: colour }}
      data-emoji={emoji}
    >
      {/* Members keep their stored emoji; it's drawn as a plain person outline in their colour. */}
      <LineIcon name="user" size={Math.round(size * 0.6)} />
    </span>
  );
}

export function Money({ amount, kind, className, currency }: { amount: number; kind?: "income" | "expense"; className?: string; currency?: string }) {
  return (
    <span
      className={cx(
        "num font-bold",
        kind === "income" && "text-mint-600",
        kind === "expense" && "text-slate-800",
        className,
      )}
    >
      {kind === "income" ? "+" : kind === "expense" ? "−" : ""}
      {formatMoney(amount, currency)}
    </span>
  );
}

export function Progress({ value, max, colour }: { value: number; max: number; colour?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const auto = value > max ? "#e5484d" : pct >= 80 ? "#f5a524" : "#2fb67c";
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colour ?? auto }} />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      {icon && <Icon value={icon} size={44} className="text-slate-400" />}
      <p className="font-bold">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() focuses the first focusable element (the close button);
      // move focus to the first form field so typing works immediately.
      d.querySelector<HTMLElement>("[data-autofocus], input:not([type=hidden]), select, textarea")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="mx-auto mb-0 mt-auto w-full max-w-none rounded-t-[2rem] bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-lg sm:rounded-[2rem]"
    >
      {open && (
        <div className="pop-in flex max-h-[90vh] flex-col">
          <header className="flex items-center justify-between px-6 pb-1 pt-5">
            <h2 className="text-lg font-bold">{title}</h2>
            <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="Tutup">
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-6 pb-6 pt-3">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 px-6 pb-5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "brand" | "amber" | "violet" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    brand: "bg-brand-100 text-brand-800",
    amber: "bg-sun-100 text-amber-800",
    violet: "bg-lilac-100 text-lilac-600",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
  /** Optional button, e.g. "Urungkan" after a delete. */
  action?: { label: string; run: () => unknown };
}
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let nextToast = 1;

function dismissToast(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  toastListeners.forEach((l) => l());
}

export function toast(text: string, tone: Toast["tone"] = "ok", action?: Toast["action"]) {
  const t = { id: nextToast++, text, tone, action };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => dismissToast(t.id), action ? 7000 : 3500);
}

/** Runs an action and shows its error as a toast instead of throwing. */
export async function attempt(action: () => unknown, success?: string): Promise<boolean> {
  try {
    await action();
    if (success) toast(success);
    return true;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    return false;
  }
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          className={cx(
            "pop-in pointer-events-auto max-w-md rounded-full px-5 py-3 text-sm font-semibold shadow-lg",
            t.tone === "ok" ? "bg-slate-800 text-white" : "bg-red-600 text-white",
          )}
        >
          {t.text}
          {t.action && (
            <button
              type="button"
              className="ml-3 rounded-full bg-white/20 px-3 py-1 font-bold hover:bg-white/30"
              onClick={() => {
                dismissToast(t.id);
                void attempt(t.action!.run);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function useToggle(initial = false) {
  const [on, set] = useState(initial);
  return [on, () => set(true), () => set(false)] as const;
}

/** Small "made by" credit linking to the author's site. */
export function MadeBy({ className }: { className?: string }) {
  return (
    <p className={cx("text-xs text-slate-400", className)}>
      Dibuat oleh{" "}
      <a
        href="https://muhammadrahmatullah.com/"
        target="_blank"
        rel="noopener"
        className="font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-brand-700 hover:decoration-brand-500"
      >
        Muhammad Rahmatullah
      </a>
    </p>
  );
}
