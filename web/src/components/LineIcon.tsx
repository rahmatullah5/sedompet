// Plain line icons (1.75px stroke, currentColor) for UI controls, so buttons
// and labels don't lean on emoji. Account / category icons chosen by the
// family stay as they are (see Icon.tsx).

const PATHS = {
  // two opposite arrows: transfer / exchange
  swap: "M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4",
  // pencil over a line: correct a balance
  adjust: "M4 20h16M14.5 5.5l3 3L9 17H6v-3z",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13z",
  refresh: "M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5",
  plus: "M12 5v14M5 12h14",
  // rising line with axis: stocks
  chart: "M4 4v16h16M7 15l4-4 3 3 5-6",
  // stacked coins: currencies
  coins: "M9 7c0 1.1 2.2 2 5 2s5-.9 5-2-2.2-2-5-2-5 .9-5 2zM9 7v4c0 1.1 2.2 2 5 2s5-.9 5-2V7M5 13c0 1.1 2.2 2 5 2M5 13c0-1.1 2.2-2 5-2M5 13v4c0 1.1 2.2 2 5 2s5-.9 5-2v-1",
  home: "M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5",
  book: "M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h11M9 8h6M9 11h4",
  bars: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  menu: "M4 7h16M4 12h16M4 17h16",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  cash: "M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 10v4M18 10v4",
  bank: "M3 9l9-5 9 5M5 9v8M9.5 9v8M14.5 9v8M19 9v8M3 20h18",
  phone: "M7 3h10v18H7zM11 18h2",
  piggy: "M5 11.5C5 8.5 8 6.5 12 6.5c1.3 0 2.5.2 3.5.6L18 5.5v3l1 1.5h1.5v3.5H19c-.6 1.3-1.6 2.3-3 3V20h-2.5v-2h-3v2H8v-3.3c-1.8-1.1-3-3-3-5.2zM15 10.5h.01M10 8h3",
  card: "M3 6h18v12H3zM3 10h18M7 15h3",
  wallet: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h10v3M16 13.5h.01",
  users: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.7 3 5.5",
} as const;

export type LineIconName = keyof typeof PATHS;

export function LineIcon({ name, size = 16, className }: { name: LineIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? "inline-block shrink-0"}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Currency code in a small plain box instead of a flag emoji. */
export function CurrencyCode({ code, className }: { code: string; className?: string }) {
  return (
    <span className={`inline-block rounded border border-slate-200 px-1 font-mono text-[10px] font-semibold leading-4 tracking-wide text-slate-600 ${className ?? ""}`}>
      {code}
    </span>
  );
}

/** "+2,25%" / "−0,48%" in green/red, no arrows. */
export function ChangePct({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span className={`num font-semibold ${up ? "text-mint-600" : "text-red-600"} ${className ?? ""}`}>
      {up ? "+" : "−"}
      {Math.abs(value).toFixed(2).replace(".", ",")}%
    </span>
  );
}
