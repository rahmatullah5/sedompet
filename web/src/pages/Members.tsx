import { useRef, useState } from "react";
import { m, MEMBER_EMOJIS } from "../db/repo";
import { exportFile, importFile, resetDatabase } from "../db/database";
import { importCashew, type ImportSummary } from "../db/importCashew";
import { can, ROLE_HINT, ROLE_LABEL, ROLES, type Role } from "../lib/permissions";
import { setSession } from "../lib/session";
import { getMode, setMode, cloudConfigured } from "../cloud/client";
import { cloud } from "../cloud/sync";
import { InviteCard } from "../cloud/CloudScreens";

const CLOUD = getMode() === "cloud";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { attempt, Avatar, Badge, Button, Card, Field, Input, Select, toast } from "../components/ui";

export function Members() {
  useDbVersion();
  const { dompet, me, members } = useCurrent();
  const manage = can.manage(me.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Keluarga 👨‍👩‍👧</h1>
        <p className="text-sm text-slate-500">Semua orang di {dompet.name} dan apa yang boleh mereka lakukan.</p>
      </div>
      <div className="space-y-4">
        <Card title={`${members.length} anggota`}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map((mem) => {
              const roles = can.assignableRoles(me.role, mem.role);
              const isMe = mem.id === me.id;
              return (
                <li key={mem.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar emoji={mem.emoji} colour={mem.colour} size={48} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800">
                      {mem.name} {isMe && <Badge tone="brand">kamu</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">{ROLE_HINT[mem.role]}</p>
                  </div>
                  {roles.length > 0 ? (
                    <Select
                      className="w-auto"
                      value={mem.role}
                      aria-label={`Peran ${mem.name}`}
                      onChange={(e) =>
                        attempt(
                          () => (CLOUD && mem.user_id ? cloud.setRole(dompet.id, mem.user_id, e.target.value as Role) : m.setMemberRole(me.id, mem.id, e.target.value as Role)),
                          `Peran ${mem.name} diubah`,
                        )
                      }
                    >
                      {/* keep the current role visible even if not assignable */}
                      {[...new Set<Role>([mem.role, ...roles])].map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{ROLE_LABEL[mem.role]}</Badge>
                  )}
                  {!isMe && !CLOUD && (
                    <Button variant="ghost" className="px-2" onClick={() => setSession({ memberId: mem.id }, { picked: true })} title={`Bertindak sebagai ${mem.name}`}>
                      Jadi {mem.name}
                    </Button>
                  )}
                  {can.removeMember(me.role, mem.role, isMe) && (
                    <Button
                      variant="ghost"
                      className="px-2 text-red-600"
                      aria-label={`Keluarkan ${mem.name}`}
                      onClick={() =>
                        confirm(`Keluarkan ${mem.name} dari ${dompet.name}? Akun pribadinya ikut terhapus.`) &&
                        attempt(
                          () => (CLOUD && mem.user_id ? cloud.removeMember(dompet.id, mem.user_id) : m.removeMember(me.id, mem.id)),
                          `${mem.name} dikeluarkan`,
                        )
                      }
                    >
                      ✕
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {manage && (CLOUD ? <InviteCard /> : <AddMember />)}
        <MyProfile key={me.id} />
      </div>

      <div className="space-y-4">
        {CLOUD ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={() =>
              confirm(`Keluar dari ${dompet.name}? Kamu tidak bisa melihat datanya lagi kecuali diundang ulang.`) &&
              attempt(() => cloud.leaveDompet(dompet.id), "Kamu sudah keluar dari Dompet")
            }
          >
            Keluar dari Dompet ini
          </Button>
        ) : (
          <HowToDemo />
        )}
        {manage && <DompetSettings key={dompet.id} />}
      </div>
    </div>
  );
}

function AddMember() {
  const { me } = useCurrent();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [emoji, setEmoji] = useState("🧑");
  const allowed = ROLES.filter((r) => r !== "owner" && (r !== "admin" || me.role === "owner"));

  return (
    <Card title="Tambah anggota">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await attempt(() => m.addMember(me.id, { name, role, emoji }), `${name.trim()} ditambahkan`)) setName("");
        }}
      >
        <div className="flex flex-wrap gap-1">
          {MEMBER_EMOJIS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setEmoji(x)}
              className={`h-9 w-9 rounded-full text-xl ${emoji === x ? "bg-brand-100 ring-2 ring-brand-600 dark:bg-brand-800/40" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nama panggilan">
            <Input value={name} maxLength={40} placeholder="mis. Nenek, Om Budi" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Peran" hint={ROLE_HINT[role]}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {allowed.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-400">
          Di versi online nanti, anggota bergabung lewat kode undangan 6 huruf. Di demo ini, anggota langsung ditambahkan.
        </p>
        <Button type="submit" disabled={!name.trim()}>
          Tambah
        </Button>
      </form>
    </Card>
  );
}

function MyProfile() {
  const { me } = useCurrent();
  const [name, setName] = useState(me.name);
  const [emoji, setEmoji] = useState(me.emoji);
  return (
    <Card title="Profilku di Dompet ini">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          attempt(() => m.updateMemberProfile(me.id, me.id, { name, emoji }), "Profil disimpan");
        }}
      >
        <Select value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-20" aria-label="Emoji">
          {[...new Set([me.emoji, ...MEMBER_EMOJIS])].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
        <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="min-w-40 flex-1" aria-label="Nama" />
        <Button type="submit" variant="secondary">
          Simpan
        </Button>
      </form>
    </Card>
  );
}

function DompetSettings() {
  const { dompet, me } = useCurrent();
  const [name, setName] = useState(dompet.name);
  return (
    <Card title="Pengaturan Dompet">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          attempt(() => m.renameDompet(me.id, name), "Nama Dompet disimpan");
        }}
      >
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Nama Dompet" />
        <Button type="submit" variant="secondary">
          Simpan
        </Button>
      </form>
      {can.deleteDompet(me.role) && (
        <Button
          variant="danger"
          className="mt-3"
          onClick={async () => {
            if (!confirm(`Hapus Dompet "${dompet.name}" beserta SEMUA datanya? Ini tidak bisa dibatalkan.`)) return;
            if (await attempt(() => m.deleteDompet(me.id), "Dompet dihapus")) setSession({ dompetId: null, memberId: null });
          }}
        >
          Hapus Dompet ini
        </Button>
      )}
    </Card>
  );
}

function HowToDemo() {
  return (
    <Card title="💡 Cara demo berbagi dompet" className="bg-sun-100">
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>
          Buka situs ini di <b>dua tab</b> (atau dua jendela berdampingan).
        </li>
        <li>
          Tab baru akan bertanya <b>“Siapa yang lagi pakai?”</b>. Pilih anggota lain, misalnya Ibu.
        </li>
        <li>Catat pengeluaran di satu tab. Tab lain langsung ikut berubah, termasuk aktivitas dan anggaran.</li>
        <li>
          Coba jadi <b>Adik</b> (Hanya lihat): tombol catat terkunci. Jadi <b>Kakak</b>: hanya bisa ubah catatan sendiri.
        </li>
        <li>
          Akun 🔒 <b>Tabungan Ayah</b> hanya terlihat saat bertindak sebagai Ayah.
        </li>
      </ol>
      <p className="mt-3 text-xs text-slate-400">Semua data tersimpan sebagai SQLite di browser ini (IndexedDB). Belum ada server.</p>
    </Card>
  );
}

export function DataTools() {
  const fileRef = useRef<HTMLInputElement>(null);
  const cashewRef = useRef<HTMLInputElement>(null);
  const { me } = useCurrent();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  function download() {
    const bytes = exportFile();
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/vnd.sqlite3" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sedompet-${new Date().toISOString().slice(0, 10)}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card title="Data">
      <div className="mb-4 rounded-2xl bg-brand-50 p-4">
        <p className="font-bold text-slate-800">📦 Pindahan dari aplikasi lain?</p>
        <p className="mt-1 text-sm text-slate-600">
          Ekspor file backup (.sql) dari aplikasi pencatat keuanganmu sebelumnya, lalu pilih filenya di sini. Akun, kategori, subkategori, transaksi, transfer,
          pinjaman dan anggaran bulanan ikut pindah. File tidak dikirim ke mana pun.
        </p>
        <Button className="mt-3" disabled={importing || !can.manage(me.role)} onClick={() => cashewRef.current?.click()}>
          {importing ? "Mengimpor…" : "Impor file backup"}
        </Button>
        {!can.manage(me.role) && <p className="mt-1 text-xs text-slate-500">Hanya pemilik/admin yang bisa mengimpor.</p>}
        <input
          ref={cashewRef}
          type="file"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setImporting(true);
            await attempt(async () => setResult(await importCashew(me.id, new Uint8Array(await file.arrayBuffer()))), "Impor selesai 🎉");
            setImporting(false);
          }}
        />
        {result && (
          <ul className="mt-3 space-y-0.5 text-sm text-slate-700">
            <li>✅ {result.transactions.toLocaleString("id-ID")} transaksi ({result.transfers} transfer, {result.adjustments} koreksi saldo)</li>
            <li>✅ {result.accounts} akun · {result.categories} kategori & subkategori</li>
            <li>✅ {result.loans} pinjaman · {result.budgets} anggaran bulanan</li>
            {(result.skipped.budgets > 0 || result.skipped.goals > 0 || result.skipped.unpaid > 0) && (
              <li className="text-xs text-slate-500">
                Dilewati: {result.skipped.budgets} anggaran non-bulanan, {result.skipped.goals} target tabungan, {result.skipped.unpaid} transaksi belum dibayar.
              </li>
            )}
          </ul>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Unduh file <code>.sqlite</code> untuk dibuka di DB Browser / <code>sqlite3</code>, atau pindahkan ke browser lain.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download}>
          ⬇️ Unduh .sqlite
        </Button>
        {!CLOUD && (
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            ⬆️ Impor .sqlite
          </Button>
        )}
        {!CLOUD && cloudConfigured && (
          <Button onClick={() => setMode("cloud")}>☁️ Pakai akun & sinkron keluarga</Button>
        )}
        {CLOUD && (
          <Button variant="ghost" onClick={() => confirm("Buka demo offline? Data akunmu tetap aman di server.") && setMode("demo")}>
            🧪 Buka demo offline
          </Button>
        )}
        <Button
          hidden={CLOUD}
          variant="danger"
          onClick={async () => {
            if (!confirm("Hapus SEMUA data di browser ini dan mulai dari awal?")) return;
            await resetDatabase();
            setSession({ dompetId: null, memberId: null });
            toast("Data dihapus");
          }}
        >
          Reset semua
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".sqlite,.db,application/vnd.sqlite3,application/x-sqlite3"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (!confirm(`Ganti semua data di browser ini dengan isi ${file.name}?`)) return;
            if (await attempt(async () => importFile(new Uint8Array(await file.arrayBuffer())), "Data diimpor"))
              setSession({ dompetId: null, memberId: null });
          }}
        />
      </div>
    </Card>
  );
}
