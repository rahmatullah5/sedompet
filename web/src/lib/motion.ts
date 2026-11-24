// Small motion helpers. CSS for the classes lives in index.css.

import { useEffect, useRef, useState } from "react";

/**
 * A number that glides to its new value (ease-out). On first render it
 * counts up from `from` (default 0) so big totals feel alive on open.
 * Returns the shown value and a key that changes when the value changes,
 * handy to replay a CSS flash.
 */
export function useCountUp(value: number, { ms = 900, from = 0 }: { ms?: number; from?: number } = {}) {
  const [shown, setShown] = useState(from);
  const [bump, setBump] = useState(0);
  const cur = useRef(from);
  const first = useRef(true);
  useEffect(() => {
    const start = cur.current;
    if (start === value) return;
    if (!first.current) setBump((b) => b + 1);
    first.current = false;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const v = start + (value - start) * (1 - (1 - k) ** 3);
      cur.current = k < 1 ? v : value;
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return [Math.round(shown), bump] as const;
}

/** Adds `in` to the element's class once it scrolls into view (pair with `.reveal`). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return void el.classList.add("in");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    // The element itself and any children marked .reveal
    [el, ...el.querySelectorAll<HTMLElement>(".reveal")].filter((n) => n.classList.contains("reveal")).forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
  return ref;
}

/**
 * A short burst of coins rising from the bottom-centre (the ＋ button),
 * after a new entry is saved. Plain DOM, cleans itself up.
 */
export function coinBurst(kind: "income" | "expense" = "expense") {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.className = "coin-burst";
  host.setAttribute("aria-hidden", "true");
  const n = 9;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("span");
    const angle = -90 + (i - (n - 1) / 2) * 14 + (Math.random() * 8 - 4);
    const dist = 90 + Math.random() * 70;
    const rad = (angle * Math.PI) / 180;
    c.style.setProperty("--x", `${Math.cos(rad) * dist}px`);
    c.style.setProperty("--y", `${Math.sin(rad) * dist}px`);
    c.style.setProperty("--r", `${Math.random() * 360 - 180}deg`);
    c.style.animationDelay = `${i * 25}ms`;
    c.className = kind === "income" ? "coin income" : "coin";
    host.appendChild(c);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 1400);
}
