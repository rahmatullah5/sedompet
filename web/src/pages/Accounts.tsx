import { useState } from "react";
import { DatePicker } from "../components/DatePicker";
import { m, q, type Account, type AccountType } from "../db/repo";
import { Icon, IconPicker } from "../components/Icon";
import { can } from "../lib/permissions";
import { formatIDR, parseAmount, todayISO } from "../lib/format";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Badge, Button, Card, Field, Input, Modal, Money, Select, STICKY_ACTIONS } from "../components/ui";

const TYPE_LABEL: Record<AccountType, string> = {
  cash: "💵 Tunai",
  bank: "🏦 Bank",
  ewallet: "📱 E-wallet",
  savings: "🐷 Tabungan",
};
const COLOURS = ["#f47c5a", "#4f8ef7", "#2fb67c", "#8b74e8", "#e5689b", "#f5a524", "#8a7563"];
const TYPE_ICON: Record<AccountType, string> = { cash: "💵", bank: "🏦", ewallet: "📱", savings: "🐷" };

export function Accounts() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const accounts = q.accounts(dompet.id, me.id);
  const [editing, setEditing] = useState<Account | "new" | "new-private" | null>(null);
  const [correcting, setCorrecting] = useState<Account | null>(null);
  const shared = accounts.filter((a) => a.visibility === "shared");
  const priv = accounts.filter((a) => a.visibility === "private");
  const manage = can.manage(me.role);
  const canEdit = (a: Account) => manage || (a.visibility === "private" && a.owner_member_id === me.id);

  const list = (items: Account[]) => (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((a) => (
        <li key={a.id} className="flex items-center gap-1">
          <button
            disabled={!canEdit(a)}
            onClick={() => setEditing(a)}
            className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left enabled:hover:bg-slate-50"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ background: `${a.colour}22` }}>
              <Icon value={a.icon ?? TYPE_ICON[a.type]} size={26} />
            </span>
            <span className="flex-1">
              <span className="block font-semibold text-slate-800">{a.name}</span>
              <span className="text-xs text-slate-500">{TYPE_LABEL[a.type].split(" ").slice(1).join(" ")}</span>
            </span>
            <Money amount={a.balance} />
          </button>
          {can.addTransaction(me.role) && (
            <button
              onClick={() => setCorrecting(a)}
              title="Koreksi saldo"
              aria-label={`Koreksi saldo ${a.name}`}
              className="shrink-0 rounded-full p-2 text-lg hover:bg-slate-100"
            >
              ⚖️
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">← Menu</a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Isi dompet 💳</h1>
        <p className="text-sm text-slate-500">Tempat uang keluarga disimpan: tunai, bank, e-wallet.</p>
      </div>
      <div className="space-y-4">
        <Card
          title={`Akun bersama · ${formatIDR(shared.reduce((s, a) => s + a.balance, 0))}`}
          action={manage && <Button onClick={() => setEditing("new")}>+ Akun</Button>}
        >
          <p className="-mt-1 mb-2 px-2 text-xs text-slate-400">Saldo beda dengan aplikasi bank? Tekan ⚖️ untuk koreksi.</p>
          {list(shared)}
          {!manage && <p className="px-2 pt-2 text-xs text-slate-400">Hanya pemilik/admin yang bisa menambah akun bersama.</p>}
        </Card>
        <Card
          title={
            <span className="flex items-center gap-2">
              🔒 Akun pribadimu <Badge tone="violet">hanya kamu yang lihat</Badge>
            </span>
          }
          action={can.addPrivateAccount(me.role) && <Button variant="secondary" onClick={() => setEditing("new-private")}>+ Pribadi</Button>}
        >
          {priv.length ? list(priv) : <p className="px-2 text-sm text-slate-500">Simpan tabungan atau dompet pribadi di sini. Anggota lain tidak bisa melihat saldonya.</p>}
        </Card>
      </div>
      <AccountForm editing={editing} onClose={() => setEditing(null)} />
      <Modal open={correcting !== null} onClose={() => setCorrecting(null)} title="Koreksi saldo ⚖️">
        {correcting && <CorrectionForm key={correcting.id} account={correcting} onClose={() => setCorrecting(null)} />}
      </Modal>
    </div>
  );
}

function AccountForm({ editing, onClose }: { editing: Account | "new" | "new-private" | null; onClose: () => void }) {
  const open = editing !== null;
  const isNew = typeof editing === "string";
  return (
    <Modal open={open} onClose={onClose} title={editing === "new-private" ? "Akun pribadi baru" : isNew ? "Akun baru" : "Ubah akun"}>
      {open && (
        <AccountFormBody
          key={isNew ? editing : editing.id}
          account={isNew ? null : editing}
          initialVisibility={editing === "new-private" ? "private" : undefined}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function AccountFormBody({ account, initialVisibility, onClose }: { account: Account | null; initialVisibility?: "private"; onClose: () => void }) {
  const { me } = useCurrent();
  const manage = can.manage(me.role);
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [opening, setOpening] = useState(account ? String(account.opening_balance) : "0");
  const [colour, setColour] = useState(account?.colour ?? COLOURS[1]);
  const [icon, setIcon] = useState<string>(account?.icon ?? TYPE_ICON[account?.type ?? "bank"]);
  const [visibility, setVisibility] = useState<"shared" | "private">(account?.visibility ?? initialVisibility ?? (manage ? "shared" : "private"));
  const openingValue = opening.trim() === "" ? 0 : parseAmount(opening);

  async function save() {
    const ok = await attempt(
      () => m.saveAccount(me.id, { id: account?.id, name, type, opening_balance: openingValue, colour, icon, visibility }),
      "Akun disimpan",
    );
    if (ok) onClose();
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Nama akun">
        <Input autoFocus value={name} maxLength={40} placeholder="mis. BCA Keluarga, GoPay Ibu" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jenis">
          <Select
            value={type}
            onChange={(e) => {
              const t = e.target.value as AccountType;
              // Follow the type's default icon unless a custom one was chosen.
              if (Object.values(TYPE_ICON).includes(icon)) setIcon(TYPE_ICON[t]);
              setType(t);
            }}
          >
            {Object.entries(TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Saldo awal" hint={Number.isFinite(openingValue) ? formatIDR(openingValue) : "Tidak valid"}>
          <Input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Ikon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <Field label="Siapa yang bisa lihat">
        <Select value={visibility} disabled={!manage} onChange={(e) => setVisibility(e.target.value as "shared" | "private")}>
          <option value="shared">👨‍👩‍👧 Seluruh anggota Dompet</option>
          <option value="private">🔒 Hanya saya</option>
        </Select>
      </Field>
      <div className="flex gap-2">
        {COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Warna ${c}`}
            onClick={() => setColour(c)}
            className="h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-slate-900"
            style={{ background: c, boxShadow: colour === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : undefined }}
          />
        ))}
      </div>
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {account && (
            <Button
              variant="danger"
              onClick={async () => {
                if (confirm(`Hapus akun ${account.name}? Semua transaksinya ikut terhapus.`) && (await attempt(() => m.deleteAccount(me.id, account.id), "Akun dihapus")))
                  onClose();
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
          <Button type="submit" disabled={!name.trim() || !Number.isFinite(openingValue)}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

function CorrectionForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { me } = useCurrent();
  const [text, setText] = useState("");
  const [date, setDate] = useState(todayISO());
  const actual = text.trim().startsWith("-") ? -parseAmount(text.trim().slice(1)) : parseAmount(text);
  const diff = Number.isFinite(actual) ? Math.round(actual) - account.balance : NaN;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await attempt(() => m.correctBalance(me.id, account.id, actual, date), "Saldo dikoreksi")) onClose();
      }}
    >
      <p className="text-sm text-slate-600">
        Saldo <b>{account.name}</b> di Sedompet sekarang <b className="num">{formatIDR(account.balance)}</b>. Masukkan saldo yang sebenarnya
        (lihat di aplikasi bank/e-wallet).
      </p>
      <Field label="Saldo sebenarnya">
        <Input autoFocus inputMode="decimal" value={text} placeholder="mis. 2.350.000" onChange={(e) => setText(e.target.value)} className="py-3 text-center !text-2xl font-extrabold" />
      </Field>
      {Number.isFinite(diff) && text.trim() !== "" && (
        <p className={`rounded-2xl px-4 py-2.5 text-sm ${diff === 0 ? "bg-slate-100 text-slate-600" : "bg-sun-100 text-slate-700"}`}>
          {diff === 0
            ? "Sudah sama. Tidak perlu koreksi."
            : `Akan dicatat koreksi ${diff > 0 ? "+" : "−"}${formatIDR(Math.abs(diff))}. Tidak dihitung sebagai pemasukan atau pengeluaran.`}
        </p>
      )}
      <DatePicker label="Per tanggal" value={date} max={todayISO()} onChange={setDate} />
      <div className={`${STICKY_ACTIONS} justify-end`}>
        <Button variant="secondary" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" disabled={!Number.isFinite(diff) || diff === 0 || text.trim() === ""}>
          Koreksi
        </Button>
      </div>
    </form>
  );
}
