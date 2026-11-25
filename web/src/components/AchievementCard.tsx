import { useEffect } from "react";
import { progressFor } from "../lib/achievements";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { coinBurst } from "../lib/motion";
import { LineIcon } from "./LineIcon";
import { Card, cx, toast } from "./ui";

/** Beranda: streak, level progress and the next badge within reach. */
export function AchievementCard() {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  if (me.role === "viewer") return null;
  const { me: s, badges, level } = progressFor(dompet.id, me, members);
  const pct = level.to ? Math.round(((level.xp - level.from) / (level.to - level.from)) * 100) : 100;
  const next = badges
    .filter((b) => !b.unlocked && b.scope === "me")
    .sort((a, b) => b.value / b.target - a.value / a.target)[0];

  return (
    <a href="#/pencapaian" className="pop-in block">
      <Card className="transition hover:-translate-y-0.5">
        <div className="flex items-center gap-3">
          <span className={cx("flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl", s.streak > 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400")}>
            <LineIcon name="flame" size={20} className={s.streak > 0 ? "streak-glow" : undefined} />
            <span className="-mt-0.5 text-xs font-extrabold leading-none">{s.streak}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-bold text-slate-800">
                Lv {level.level} · {level.title}
              </span>
              <span className="shrink-0 text-xs font-semibold text-brand-700">Lihat →</span>
            </p>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-slate-500">
              {!s.recordedToday
                ? s.streak > 0
                  ? `Catat hari ini, jaga ${s.streak} hari beruntunmu`
                  : "Catat hari ini untuk mulai beruntun"
                : next
                  ? `Berikutnya: ${next.title} (${next.value}/${next.target})`
                  : "Semua lencanamu sudah terbuka!"}
            </p>
          </div>
        </div>
      </Card>
    </a>
  );
}

/**
 * Celebrates new badges and level-ups for the person using the app. The first
 * run on a device only remembers what is already unlocked (no flood).
 */
export function AchievementWatcher() {
  const version = useDbVersion();
  const { dompet, me, members } = useCurrent();
  useEffect(() => {
    if (me.role === "viewer") return;
    const t = window.setTimeout(() => {
      const { badges, level } = progressFor(dompet.id, me, members);
      const key = `sedompet.badges.${dompet.id}.${me.id}`;
      const now = badges.filter((b) => b.unlocked).map((b) => b.id);
      let seen: { ids: string[]; level: number } | null = null;
      try {
        seen = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        /* ignore */
      }
      const save = () => {
        try {
          localStorage.setItem(key, JSON.stringify({ ids: now, level: level.level }));
        } catch {
          /* ignore */
        }
      };
      if (!seen) return save();
      const fresh = badges.filter((b) => b.unlocked && !seen!.ids.includes(b.id));
      if (fresh.length === 0 && level.level <= seen.level) return save();
      save();
      window.setTimeout(() => {
        coinBurst("income");
        if (level.level > seen!.level) toast(`Naik level! Lv ${level.level} · ${level.title}`);
        for (const b of fresh.slice(0, 2)) toast(`Lencana baru: ${b.title}${b.scope === "family" ? " (keluarga)" : ""}`);
      }, 900);
    }, 700);
    return () => window.clearTimeout(t);
  }, [version, dompet.id, me, members]);
  return null;
}
