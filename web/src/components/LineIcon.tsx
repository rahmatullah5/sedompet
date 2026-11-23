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
  minus: "M5 12h14",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  // circle cut into a slice: share of a whole
  pie: "M12 3v9h9M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z",
  eyeOff: "M3 3l18 18M10.6 6a9.8 9.8 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.6 3.3M6.5 7.6A16.6 16.6 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2",
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
  // --- everyday categories (also used for emoji stored as category/goal icons)
  food: "M5 3v7a3 3 0 0 0 6 0V3M8 3v18M16 21V3c2.2 0 4 2.2 4 6s-1.8 5-4 5",
  cup: "M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v2M11 3v2",
  cart: "M3 4h2.5l2 11h11l2-8H6.5M9 20h.01M17 20h.01",
  bag: "M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2",
  store: "M4 9l1.5-5h13L20 9M4 9h16M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M5.5 12v8h13v-8M10 20v-5h4v5",
  sofa: "M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v6H3zM5 17v2M19 17v2",
  broom: "M14 3l-3 8M8 11h6l2 10H6z",
  wrench: "M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  drop: "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
  flame: "M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .5 2 1.5 3 2.5 3 0-3-1-5 0-8z",
  wifi: "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  tv: "M3 6h18v12H3zM8 21h8M9 3l3 3 3-3",
  baby: "M12 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM9.5 11h.01M14.5 11h.01M10 14.5c1.2.8 2.8.8 4 0M12 4c0 1.5 1 2.5 2 2.5",
  school: "M2 9l10-5 10 5-10 5zM6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6",
  book2: "M4 5c3-1.3 6-1.3 8 0v15c-2-1.3-5-1.3-8 0zM20 5c-3-1.3-6-1.3-8 0v15c2-1.3 5-1.3 8 0z",
  paw: "M12 13c-3 0-5 3-5 5 0 1.5 1.3 2 2.5 2 1 0 1.5-.5 2.5-.5s1.5.5 2.5.5c1.2 0 2.5-.5 2.5-2 0-2-2-5-5-5zM6 10.5a1.5 2 0 1 0 0-.01M18 10.5a1.5 2 0 1 0 0-.01M9.5 6a1.5 2 0 1 0 0-.01M14.5 6a1.5 2 0 1 0 0-.01",
  health: "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z",
  pill: "M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7zM7 10l7 7",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  shirt: "M8 3L3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c0 1.7-1.3 3-4 3S8 4.7 8 3z",
  gift: "M4 10h16v11H4zM3 7h18v3H3zM12 7v14M12 7c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1",
  mosque: "M12 3c-3 2-5 4-5 7h10c0-3-2-5-5-7zM5 10h14v10H5zM10 20v-4a2 2 0 0 1 4 0v4M3 20h18M3 20V8",
  scooter: "M6 17a2.5 2.5 0 1 0 0-.01M18 17a2.5 2.5 0 1 0 0-.01M8.5 17h7l3-7h-4M14 5h3l1.5 5M4 13h6l2 4",
  car: "M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7.5 13.5h.01M16.5 13.5h.01M5 11h14",
  bus: "M6 3h12a2 2 0 0 1 2 2v12H4V5a2 2 0 0 1 2-2zM4 11h16M8 20v-3M16 20v-3M8 14h.01M16 14h.01",
  plane: "M10.5 21l1.5-1 1.5 1v-3l-1.5-1.5V14l8 3v-2.5l-8-5.5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5.5V17l8-3v2.5L9 18v3z",
  fuel: "M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 2v7a1.5 1.5 0 0 0 3 0V9l-2-3",
  game: "M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-.6.8A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4zM8 11v3M6.5 12.5h3M15.5 11.5h.01M17.5 13h.01",
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  ball: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7l4 3-1.5 4.5h-5L8 10zM12 3v4M16 10l4.5-1.5M14.5 14.5l2.5 4M9.5 14.5l-2.5 4M8 10L3.5 8.5",
  laptop: "M5 5h14v10H5zM2 19h20",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  handshake: "M3 11l4-4 5 2 5-2 4 4M3 11v4l6 5 3-2 3 2 6-5v-4M9 12l3 3M12 9l4 4",
  coin: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5",
  briefcase: "M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18",
  receipt: "M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  repeat: "M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
  star: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9z",
  heart: "M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z",
  leaf: "M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7.5h.01",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  user: "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4.4 3.6-8 8-8s8 3.6 8 8",
  trend_down: "M4 4v16h16M7 9l4 4 3-3 5 6",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4",
  share: "M12 3v12M7 8l5-5 5 5M5 13v7h14v-7",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 3l10 17H2zM12 10v4M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  cloud: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z",
  key: "M8 15a4 4 0 1 1 0-.01M11 12l9-9M16 7l3 3M14 9l2 2",
  message: "M4 5h16v11H9l-5 4z",
  undo: "M9 14l-5-5 5-5M4 9h10a6 6 0 0 1 0 12h-3",
  split: "M12 3v18M5 8h4M5 12h4M15 12h4M15 16h4",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.7 3 5.5",
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
