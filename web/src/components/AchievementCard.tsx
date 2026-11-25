import { useEffect } from "react";
import { borosFor, progressFor } from "../lib/achievements";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { coinBurst } from "../lib/motion";
import { currentMonth } from "../lib/format";
import { LineIcon } from "./LineIcon";
import { Card, cx, toast } from "./ui";

/** Beranda: streak, level progress and the next badge within reach. */
export function AchievementCard() {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  if (me.role === "viewer") return null;
  const { me: s, badges, penalties, level } = progressFor(dompet.id, me, members);
  const cards = penalties.filter((p) => p.active);
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
            {cards.length > 0 && (
              <p className="mt-1 flex items-center gap-1.5 truncate text-xs font-semibold text-amber-700">
                <span className="h-3 w-2.5 shrink-0 -rotate-6 rounded-[2px] bg-amber-400" />
                {cards.length === 1 ? `Kartu kuning: ${cards[0].title}` : `${cards.length} kartu kuning aktif`} (−{cards.reduce((t, p) => t + p.xp, 0)} XP)
              </p>
            )}
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
      const { badges, penalties, level } = progressFor(dompet.id, me, members);
      const cards = penalties.filter((p) => p.active).map((p) => p.id);
      const boros = borosFor(dompet.id, members).filter((b) => b.memberId === me.id);
      const borosIds = boros.map((b) => `${currentMonth()}:${b.id}`);
      const key = `sedompet.badges.${dompet.id}.${me.id}`;
      const now = badges.filter((b) => b.unlocked).map((b) => b.id);
      let seen: { ids: string[]; level: number; cards?: string[]; boros?: string[] } | null = null;
      try {
        seen = JSON.parse(localStorage.getItem(key) ?? "null");
      } catch {
        /* ignore */
      }
      const save = () => {
        try {
          localStorage.setItem(key, JSON.stringify({ ids: now, level: level.level, cards, boros: borosIds }));
        } catch {
          /* ignore */
        }
      };
      if (!seen) return save();
      const fresh = badges.filter((b) => b.unlocked && !seen!.ids.includes(b.id));
      // First run with penalties: remember them quietly.
      const prevCards = seen.cards ?? cards;
      const given = penalties.filter((p) => p.active && !prevCards.includes(p.id));
      const lifted = penalties.filter((p) => !p.active && prevCards.includes(p.id));
      const prevBoros = seen.boros ?? borosIds;
      const shame = boros.filter((b) => !prevBoros.includes(`${currentMonth()}:${b.id}`));
      if (given.length || lifted.length || shame.length)
        window.setTimeout(() => {
          for (const b of shame.slice(0, 2)) toast(`Lencana boros: ${b.title}. Hayo, keluarga bisa lihat!`, "error");
          for (const p of given.slice(0, 2)) toast(`Kartu kuning! ${p.title} (−${p.xp} XP)`, "error");
          for (const p of lifted.slice(0, 2)) toast(`Kartu kuning ${p.title} dicabut. Mantap!`);
        }, 1400);
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
