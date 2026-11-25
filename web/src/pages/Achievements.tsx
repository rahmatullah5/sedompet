import { useState } from "react";
import { all } from "../db/database";
import { boardFor, borosFor, LEVELS, progressFor, type Badge, type Penalty } from "../lib/achievements";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { todayISO, toISODate } from "../lib/format";
import { LineIcon } from "../components/LineIcon";
import { Avatar, Card, cx } from "../components/ui";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function weekDates() {
  const now = new Date(todayISO() + "T00:00");
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return toISODate(d);
  });
}

/** Pencapaian: your level and streak, the family's weekly mission, and badges. */
export function Achievements() {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const { me: stats, fam, badges, penalties, level } = progressFor(dompet.id, me, members);
  const cards = penalties.filter((p) => p.active);
  const boros = borosFor(dompet.id, members);
  const minus = cards.reduce((t, p) => t + p.xp, 0);
  const board = boardFor(dompet.id, members.filter((m) => m.role !== "viewer"), fam);
  const [tab, setTab] = useState<"me" | "family">("me");
  const shown = badges.filter((b) => b.scope === tab);
  const unlocked = shown.filter((b) => b.unlocked).length;
  const pct = level.to ? Math.round(((level.xp - level.from) / (level.to - level.from)) * 100) : 100;
  const days = weekDates();
  const questPct = fam.quest.target ? Math.round((fam.quest.done / fam.quest.target) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Pencapaian</h1>
        <p className="text-sm text-slate-500">Rajin mencatat, makin paham uang keluarga. Dikejar bareng, bukan dilombakan.</p>
      </div>

      {/* Level + streak */}
      <div className="pop-in relative overflow-hidden rounded-[2rem] bg-brand-600 p-5 text-white">
        <div className="flex items-center gap-3">
          <Avatar emoji={me.emoji} colour={me.colour} size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-brand-100">Level {level.level}</p>
            <p className="text-xl font-extrabold leading-tight tracking-tight">{level.title}</p>
          </div>
          <div className="flex flex-col items-center rounded-2xl bg-white/15 px-3 py-2">
            <span className={cx("flex items-center gap-1 text-2xl font-extrabold leading-none", stats.streak > 0 && "streak-glow")}>
              <LineIcon name="flame" size={22} />
              {stats.streak}
            </span>
            <span className="mt-0.5 text-[10px] font-semibold text-brand-100">hari beruntun</span>
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-white transition-[width] duration-700" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-brand-100">
          <span className="num">{level.xp} XP</span>
          <span>{level.to ? `${level.to - level.xp} XP lagi ke ${LEVELS[level.level].title}` : "Level tertinggi!"}</span>
        </div>
        {!stats.recordedToday && (
          <a href="#/catat" className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-brand-700">
            <span>{stats.streak > 0 ? `Catat hari ini supaya ${stats.streak} hari beruntunmu tidak putus` : "Mulai beruntun: catat satu transaksi hari ini"}</span>
            <LineIcon name="plus" size={18} />
          </a>
        )}
      </div>

      {/* Kartu kuning: playful penalties */}
      <Card
        title="Kartu kuning"
        className={cards.length ? "ring-2 ring-amber-200" : undefined}
        action={cards.length ? <span className="text-xs font-bold text-amber-700">−{minus} XP</span> : <span className="text-xs font-bold text-mint-600">Bersih</span>}
      >
        {cards.length === 0 ? (
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-mint-50 text-mint-600">
              <LineIcon name="check" size={22} />
            </span>
            <p className="text-sm text-slate-600">Tidak ada kartu kuning. Dompet keluarga sedang tertib, pertahankan!</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cards.map((p) => (
              <PenaltyRow key={p.id} p={p} />
            ))}
          </ul>
        )}
        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold">Daftar pelanggaran ({penalties.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {penalties.map((p) => (
              <li key={p.id} className="flex gap-2">
                <LineIcon name={p.icon} size={14} className={cx("mt-0.5 shrink-0", p.active ? "text-amber-600" : "text-slate-300")} />
                <span>
                  <b className="text-slate-700">{p.title}</b> {p.scope === "family" && <span className="text-slate-400">(keluarga)</span>} · −{p.xp} XP · {p.fix}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-slate-400">Cuma bercanda, tapi beneran mengingatkan. Kartu otomatis dicabut begitu kebiasaannya beres, XP-nya kembali.</p>
        </details>
      </Card>

      {/* Lencana boros: monthly joke badges */}
      <Card title="Lencana boros bulan ini" action={<span className="text-xs font-semibold text-slate-400">reset tiap bulan</span>}>
        {boros.length === 0 ? (
          <p className="text-sm text-slate-600">Belum ada yang dapat lencana boros bulan ini. Keluarga hemat, dompet senang!</p>
        ) : (
          <ul className="space-y-2">
            {boros.map((b) => {
              const who = members.find((m) => m.id === b.memberId);
              return (
                <li key={`${b.memberId}-${b.id}`} className="flex gap-3 rounded-2xl bg-rose-50 p-3">
                  <span className="relative shrink-0">
                    {who && <Avatar emoji={who.emoji} colour={who.colour} size={40} />}
                    <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white ring-2 ring-rose-50">
                      <LineIcon name={b.icon} size={11} />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold text-slate-800">
                      {b.title}
                      <span className="ml-1.5 text-xs font-semibold text-rose-600">{who?.id === me.id ? "kamu" : who?.name}</span>
                    </p>
                    <p className="text-xs text-slate-600">{b.joke}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[11px] text-slate-400">
          Cuma bercanda, tidak mengurangi XP. Dihitung dari belanja akun bersama yang dibayar tiap anggota, jadi akun pribadi tetap rahasia.
        </p>
      </Card>

      {/* Weekly family mission */}
      <Card
        title="Misi keluarga minggu ini"
        action={<span className={cx("text-xs font-bold", questPct >= 100 ? "text-mint-600" : "text-slate-400")}>{questPct >= 100 ? "Selesai!" : `${questPct}%`}</span>}
      >
        <p className="text-sm text-slate-600">Setiap anggota mencatat di 3 hari berbeda. Saling ingatkan ya.</p>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className={cx("h-full rounded-full transition-[width] duration-700", questPct >= 100 ? "bg-mint-600" : "bg-brand-500")} style={{ width: `${Math.min(100, questPct)}%` }} />
        </div>
        <ul className="mt-4 space-y-3">
          {board.map(({ member, stats: s, level: l, cards: yellow }) => {
            const active = new Set(
              days.filter((d) => d <= todayISO()).filter((d) => s.weekDays > 0 && dayHasEntry(dompet.id, member.id, d)),
            );
            return (
              <li key={member.id} className="flex items-center gap-3">
                <Avatar emoji={member.emoji} colour={member.colour} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-bold text-slate-800">
                      {member.name}
                      {member.id === me.id && <span className="ml-1 text-[10px] font-semibold text-slate-400">(kamu)</span>}
                      <span className="ml-1.5 text-[11px] font-medium text-slate-400">
                        Lv {l.level} · {l.title}
                      </span>
                    </p>
                    {yellow > 0 && (
                      <span title={`${yellow} kartu kuning`} className="flex h-5 shrink-0 items-center gap-0.5 rounded-md bg-amber-100 px-1.5 text-[10px] font-extrabold text-amber-700">
                        <span className="h-2.5 w-2 rounded-[2px] bg-amber-400" />
                        {yellow}
                      </span>
                    )}
                    <span className={cx("flex shrink-0 items-center gap-0.5 text-sm font-extrabold", s.streak > 0 ? "text-brand-600" : "text-slate-300")}>
                      <LineIcon name="flame" size={15} />
                      {s.streak}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1" aria-label={`${member.name}: ${s.weekDays} hari minggu ini`}>
                    {days.map((d, i) => (
                      <span
                        key={d}
                        title={WEEKDAYS[i]}
                        className={cx(
                          "flex h-5 flex-1 items-center justify-center rounded-full text-[9px] font-bold",
                          active.has(d) ? "bg-brand-600 text-white" : d === todayISO() ? "bg-white text-slate-400 ring-2 ring-brand-200" : "bg-slate-100 text-slate-300",
                        )}
                      >
                        {WEEKDAYS[i]}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <LineIcon name="users" size={14} />
          Keluarga beruntun {fam.streak} hari · terbaik {fam.bestStreak} hari
        </p>
      </Card>

      {/* Badges */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex rounded-full bg-slate-100 p-1 text-sm font-semibold">
            {(["me", "family"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={cx("rounded-full px-3.5 py-1.5 transition", tab === t ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}
              >
                {t === "me" ? "Lencanaku" : "Lencana keluarga"}
              </button>
            ))}
          </div>
          <span className="text-xs font-semibold text-slate-400">
            {unlocked}/{shown.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shown
            .slice()
            .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.value / b.target - a.value / a.target)
            .map((b) => (
              <BadgeTile key={b.id} b={b} />
            ))}
        </div>
      </Card>

      <details className="rounded-3xl bg-white p-4 text-sm text-slate-600 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
        <summary className="cursor-pointer font-bold text-slate-800">Cara dapat XP</summary>
        <ul className="mt-2 space-y-1">
          <li>• +10 XP tiap hari kamu mencatat (berapa pun jumlahnya)</li>
          <li>• +2 XP tiap catatan, +5 kalau ada foto struk</li>
          <li>• +2 XP tiap tanda Kebutuhan/Keinginan</li>
          <li>• +25 XP tiap lencanamu, +15 tiap lencana keluarga</li>
          <li>• −5 sampai −15 XP tiap kartu kuning yang masih aktif (kembali saat dicabut)</li>
        </ul>
        <p className="mt-2 text-xs text-slate-400">Hanya jumlah catatan yang dihitung, bukan nominalnya. Catatan akun pribadi tetap tidak terlihat orang lain.</p>
      </details>
    </div>
  );
}

function PenaltyRow({ p }: { p: Penalty }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-amber-50 p-3">
      <span className="relative flex h-11 w-9 shrink-0 -rotate-6 items-center justify-center rounded-md bg-amber-400 text-white shadow-sm">
        <LineIcon name={p.icon} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-extrabold text-slate-800">
            {p.title}
            {p.scope === "family" && <span className="ml-1 text-[10px] font-semibold text-amber-700">keluarga</span>}
          </span>
          <span className="shrink-0 text-xs font-bold text-amber-700">−{p.xp} XP</span>
        </p>
        <p className="text-xs text-slate-600">{p.joke}</p>
        <p className="mt-1 text-[11px] font-semibold text-amber-800">Cara lepas: {p.fix}</p>
      </div>
    </li>
  );
}

function BadgeTile({ b }: { b: Badge }) {
  return (
    <div className={cx("rounded-2xl p-3", b.unlocked ? "bg-brand-50" : "bg-slate-50")}>
      <span
        className={cx(
          "flex h-11 w-11 items-center justify-center rounded-2xl",
          b.unlocked ? (b.scope === "family" ? "bg-mint-600 text-white shadow-sm" : "bg-brand-600 text-white shadow-sm") : "bg-white text-slate-300",
        )}
      >
        <LineIcon name={b.icon} size={22} />
      </span>
      <p className={cx("mt-2 text-sm font-bold leading-tight", b.unlocked ? "text-slate-800" : "text-slate-500")}>{b.title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{b.hint}</p>
      {!b.unlocked && b.target > 1 && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((b.value / b.target) * 100)}%` }} />
          </div>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
            {b.value}/{b.target}
          </p>
        </div>
      )}
    </div>
  );
}

function dayHasEntry(dompetId: string, memberId: string, date: string) {
  return (
    (all<{ n: number }>(
      "SELECT count(*) AS n FROM transactions WHERE dompet_id = ? AND created_by = ? AND date = ? AND (flag IS NULL OR flag = 'transfer')",
      [dompetId, memberId, date],
    )[0]?.n ?? 0) > 0
  );
}
