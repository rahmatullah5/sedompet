import { useState } from "react";
import { m, q, type Goal } from "../db/repo";
import { can } from "../lib/permissions";
import { formatCompact, formatIDR, parseAmount, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Badge, Button, Card, cx, Empty, Field, Input, Modal, Progress, Select, STICKY_ACTIONS } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Icon, IconPicker } from "../components/Icon";

const monthFmt = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric" });

/** Whole months from now until `iso` (at least 1). */
function monthsUntil(iso: string) {
  const [y, mo] = iso.split("-").map(Number);
  const now = new Date();
  return Math.max(1, (y - now.getFullYear()) * 12 + (mo - 1 - now.getMonth()));
}

/** Progress maths shared by the page and the Beranda card. */
export function goalStatus(g: Goal) {
  const left = Math.max(0, g.target - g.progress);
  const done = left === 0;
  const late = !done && !!g.target_date && g.target_date < todayISO();
  const months = g.target_date && !late ? monthsUntil(g.target_date) : null;
  const perMonth = months ? Math.ceil(left / months) : null;
  return { left, done, late, months, perMonth, pct: Math.min(100, Math.round((g.progress / g.target) * 100)) };
}

export function GoalRow({ g, compact }: { g: Goal; compact?: boolean }) {
  const s = goalStatus(g);
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sun-100 text-xl">
          <Icon value={g.icon} size={26} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-slate-800">{g.name}</span>
            {s.done && <Badge tone="brand">Tercapai 🎉</Badge>}
            {s.late && <Badge tone="amber">Lewat target</Badge>}
          </span>
          <span className="block text-xs text-slate-500">
            {formatCompact(g.progress)} dari {formatCompact(g.target)} · {s.pct}%
            {g.target_date && ` · ${monthFmt.format(new Date(g.target_date + "T00:00"))}`}
          </span>
        </span>
      </div>
      <div className="mt-2">
        <Progress value={g.progress} max={g.target} colour={s.done ? "#2fb67c" : "#f5a524"} />
      </div>
      {!compact && !s.done && (
        <p className="mt-1.5 text-xs text-slate-500">
          {s.perMonth
            ? `Sisihkan ≈ ${formatIDR(s.perMonth)}/bulan selama ${s.months} bulan lagi.`
            : `Kurang ${formatIDR(s.left)}.`}
          {g.account_id && ` Mengikuti saldo ${g.account_visibility === "private" ? "🔒 " : ""}${g.account_name}.`}
        </p>
      )}
    </div>
  );
}

export function Goals() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const goals = q.goals(dompet.id, me.id);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [moving, setMoving] = useState<Goal | null>(null);
  const manage = can.manage(me.role);
  const canSave = can.addTransaction(me.role);
  const total = goals.reduce((s, g) => s + Math.min(g.progress, g.target), 0);
  const target = goals.reduce((s, g) => s + g.target, 0);

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">← Menu</a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Tabungan tujuan 🎯</h1>
        <p className="text-sm text-slate-500">Umroh, sekolah, laptop, dana darurat: kumpulkan bersama, pantau bersama.</p>
      </div>
      {goals.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-slate-500">Terkumpul untuk semua tujuan</p>
          <p className="num mt-1 text-2xl font-extrabold text-slate-800">
            {formatIDR(total)} <span className="text-base font-semibold text-slate-400">/ {formatCompact(target)}</span>
          </p>
          <div className="mt-2">
            <Progress value={total} max={target} colour="#f5a524" />
          </div>
        </Card>
      )}
      <Card title={`Tujuan (${goals.length})`} action={manage && <Button onClick={() => setEditing("new")}>+ Tujuan</Button>}>
        {goals.length === 0 ? (
          <Empty icon="🎯" title="Belum ada tujuan">
            {manage ? "Buat tujuan pertama, mis. Umroh atau Dana darurat." : "Minta pemilik/admin membuat tujuan keluarga."}
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {goals.map((g) => (
              <li key={g.id} className="py-3">
                <button
                  className="w-full rounded-2xl px-2 py-1 text-left enabled:hover:bg-slate-50"
                  disabled={!manage}
                  onClick={() => setEditing(g)}
                >
                  <GoalRow g={g} />
                </button>
                {canSave && !g.account_id && (
                  <div className="mt-2 flex gap-2 px-2">
                    <Button className="px-3 py-1.5 text-sm" onClick={() => setMoving(g)}>
                      + Setor
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Tujuan baru" : "Ubah tujuan"}>
        {editing && <GoalForm key={editing === "new" ? "new" : editing.id} goal={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving ? `${moving.name}` : ""}>
        {moving && <DepositForm key={moving.id} goal={moving} onClose={() => setMoving(null)} />}
      </Modal>
    </div>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { dompet, me } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id);
  const [name, setName] = useState(goal?.name ?? "");
  const [icon, setIcon] = useState(goal?.icon ?? "🎯");
  const [targetText, setTargetText] = useState(goal ? String(goal.target) : "");
  const [date, setDate] = useState(goal?.target_date ?? "");
  const [accountId, setAccountId] = useState(goal?.account_id ?? "");
  const [savedText, setSavedText] = useState(goal ? String(goal.saved) : "0");
  const target = parseAmount(targetText);
  const saved = savedText.trim() ? parseAmount(savedText) : 0;
  const valid = name.trim() && target > 0 && (accountId || (Number.isFinite(saved) && saved >= 0));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () => m.saveGoal(me.id, { id: goal?.id, name, icon, target, target_date: date || null, account_id: accountId || null, saved: accountId ? (goal?.saved ?? 0) : saved }),
          goal ? "Tujuan diperbarui" : "Tujuan dibuat 🎯",
        );
        if (ok) onClose();
      }}
    >
      <Field label="Untuk apa?">
        <Input autoFocus value={name} maxLength={40} placeholder="mis. Umroh, Laptop Kakak, Dana darurat" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Ikon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <Field label="Target" hint={target > 0 ? formatIDR(target) : "mis. 60jt"}>
        <Input inputMode="decimal" value={targetText} onChange={(e) => setTargetText(e.target.value)} />
      </Field>
      <DatePicker label="Target tercapai (opsional)" value={date} min={todayISO()} onChange={setDate} optional presets="goal" placeholder="Tanpa tenggat" />
      <Field label="Uangnya dikumpulkan di" hint={accountId ? "Progres mengikuti saldo akun ini (dalam Rupiah)." : "Catat sendiri tiap kali menabung lewat tombol Setor."}>
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">✍️ Catat manual</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.visibility === "private" ? "🔒 " : ""}
              {a.name} · {formatCompact(a.balance_base)}
            </option>
          ))}
        </Select>
      </Field>
      {accounts.find((a) => a.id === accountId)?.visibility === "private" && (
        <p className="-mt-1 text-xs text-slate-400">Akun pribadi: tujuan ini hanya terlihat olehmu.</p>
      )}
      {!accountId && (
        <Field label="Sudah terkumpul" hint={Number.isFinite(saved) ? formatIDR(saved) : "Tidak valid"}>
          <Input inputMode="decimal" value={savedText} onChange={(e) => setSavedText(e.target.value)} />
        </Field>
      )}
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {goal && (
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm(`Hapus tujuan ${goal.name}? Saldo akun tidak berubah.`) && (await attempt(() => m.deleteGoal(me.id, goal.id), "Tujuan dihapus"))) onClose();
              }}
            >
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={!valid}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

function DepositForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { me } = useCurrent();
  const [dir, setDir] = useState<"in" | "out">("in");
  const [text, setText] = useState("");
  const amount = parseAmount(text);
  const s = goalStatus(goal);
  const quick = [s.perMonth, s.left].filter((v, i, a): v is number => !!v && v > 0 && a.indexOf(v) === i);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => m.adjustGoal(me.id, goal.id, dir === "in" ? amount : -amount), dir === "in" ? "Tersimpan! 💪" : "Dicatat")) onClose();
      }}
    >
      <p className="text-sm text-slate-500">
        Terkumpul {formatIDR(goal.saved)} dari {formatIDR(goal.target)}.
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup">
        {(
          [
            ["in", "Setor"],
            ["out", "Ambil"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={dir === k}
            onClick={() => setDir(k)}
            className={cx("rounded-full py-1.5 text-sm font-semibold", dir === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500")}
          >
            {label}
          </button>
        ))}
      </div>
      <Field label="Jumlah" hint={amount > 0 ? formatIDR(amount) : "mis. 500rb"}>
        <Input autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} className="py-2.5 text-center !text-2xl font-extrabold" />
      </Field>
      {dir === "in" && quick.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {quick.map((v) => (
            <button key={v} type="button" onClick={() => setText(String(v))} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-brand-100">
              {v === s.left ? "Lunasi" : "Bulan ini"} · {formatCompact(v)}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400">Hanya mencatat progres tujuan. Saldo akun tidak berubah.</p>
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!(amount > 0)}>
          Simpan
        </Button>
      </div>
    </form>
  );
}
