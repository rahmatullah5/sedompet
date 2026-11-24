// The app icon, alive: a coin drops into the wallet, the wallet catches it
// with a small squash, the clasp glints. Loops while the app loads.
// Motion lives in index.css (.ll-*) and stops under prefers-reduced-motion.

export function LoadingLogo({ size = 96 }: { size?: number }) {
  return (
    <div className="ll-wrap" style={{ width: size }} aria-hidden>
      <svg className="ll-tile" viewBox="0 0 512 512" width={size} height={size}>
        <defs>
          <linearGradient id="ll-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f47c5a" />
            <stop offset="1" stopColor="#d4502e" />
          </linearGradient>
          <clipPath id="ll-clip">
            <rect width="512" height="512" rx="116" />
          </clipPath>
        </defs>
        <g clipPath="url(#ll-clip)">
          <rect width="512" height="512" fill="url(#ll-g)" />
          <g className="ll-wallet">
            <path className="ll-flap" d="M150 160 L320 112 a24 24 0 0 1 30 18 L358 160 Z" fill="#ffc9b3" />
            <g className="ll-coin">
              <circle cx="256" cy="120" r="34" fill="#fbc93d" />
              <circle cx="256" cy="120" r="22" fill="none" stroke="#f5a524" strokeWidth="7" />
            </g>
            <rect x="112" y="160" width="288" height="210" rx="44" fill="#fff8f1" />
            <rect x="300" y="232" width="124" height="70" rx="35" fill="#f5a524" />
            <circle className="ll-dot" cx="338" cy="267" r="15" fill="#fff8f1" />
          </g>
        </g>
      </svg>
      <div className="ll-shadow" />
    </div>
  );
}
