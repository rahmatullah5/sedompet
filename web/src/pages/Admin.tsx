import { useEffect, useState, useSyncExternalStore } from "react";
import { cloud, cloudStore, type ActivationCode, type AppPhone } from "../cloud/sync";
import { displayPhone, inviteLink } from "../cloud/client";
import { attempt, Badge, Button, Card, cx, Empty, Field, Input, toast } from "../components/ui";

const fmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const day = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "—");

function codeStatus(c: ActivationCode): { label: string; tone: "brand" | "amber" | "slate" } {
  if (c.used_at) return { label: `Dipakai ${displayPhone(c.used_phone)}`, tone: "slate" };
  if (c.revoked) return { label: "Dibatalkan", tone: "slate" };
  if (new Date(c.expires_at) < new Date()) return { label: "Kedaluwarsa", tone: "amber" };
  return { label: "Siap dipakai", tone: "brand" };
}

/** App admin only: single-use activation codes and the list of numbers. */
export function Admin() {
  const { appAdmin } = useSyncExternalStore(cloudStore.subscribe, cloudStore.get);
  const [codes, setCodes] = useState<ActivationCode[]>([]);
  const [phones, setPhones] = useState<AppPhone[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [c, p] = await Promise.all([cloud.listActivationCodes(), cloud.listPhones()]);
    setCodes(c);
    setPhones(p);
  };
  useEffect(() => {
    if (appAdmin) void attempt(reload);
  }, [appAdmin]);

  if (!appAdmin) {
    return (
      <Card>
        <Empty icon="🔒" title="Khusus admin Sedompet" />
      </Card>
    );
  }

  const share = async (code: string) => {
    const text = `Halo! Ini kode untuk membuat akun Sedompet kamu:\n${inviteLink(code)}\nKode aktivasi: ${code}\n(Hanya untuk 1 orang.)`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Pesan disalin. Tempel di WhatsApp 📋");
      }
    } catch {
      /* cancelled */
    }
  };

  const open = codes.filter((c) => !c.used_at && !c.revoked && new Date(c.expires_at) >= new Date());
  const done = codes.filter((c) => !open.includes(c));

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Admin 🛡️</h1>
        <p className="text-sm text-slate-500">Buat kode aktivasi untuk orang baru. Satu kode = satu akun. Mereka lalu membuat Dompet sendiri.</p>
      </div>

      <Card title="Buat kode aktivasi">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await attempt(async () => {
              const c = await cloud.createActivationCode(note);
              setNote("");
              await reload();
              await share(c.code);
            }, "Kode dibuat");
            setBusy(false);
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label="Untuk siapa? (catatan)">
              <Input value={note} maxLength={80} placeholder="mis. Om Budi" onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Membuat…" : "Buat & bagikan"}
          </Button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Berlaku 30 hari. Orangnya buka link, pilih “Daftar pertama kali”, isi nomor & PIN.</p>
      </Card>

      <Card title={`Kode aktif (${open.length})`}>
        {open.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada kode aktif.</p>
        ) : (
          <ul className="space-y-2">
            {open.map((c) => (
              <li key={c.code} className="flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3">
                <span className="num text-lg font-extrabold tracking-[0.2em] text-slate-800">{c.code}</span>
                <span className="min-w-0 flex-1 text-xs text-slate-500">
                  {c.note ?? "—"} · s.d. {day(c.expires_at)}
                </span>
                <Button variant="ghost" className="px-2" onClick={() => share(c.code)}>
                  Bagikan
                </Button>
                <Button
                  variant="ghost"
                  className="px-2 text-red-600"
                  onClick={() => confirm(`Batalkan kode ${c.code}?`) && attempt(async () => (await cloud.revokeActivationCode(c.code), await reload()), "Kode dibatalkan")}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-500">Riwayat kode ({done.length})</summary>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {done.map((c) => {
                const s = codeStatus(c);
                return (
                  <li key={c.code} className="flex items-center gap-2 py-2">
                    <span className="num font-bold tracking-widest text-slate-500">{c.code}</span>
                    <span className="flex-1 truncate text-xs text-slate-400">{c.note ?? ""}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </Card>

      <Card title={`Nomor terdaftar (${phones.length})`}>
        <ul className="divide-y divide-slate-100">
          {phones.map((p) => (
            <li key={p.phone} className={cx("flex flex-wrap items-center gap-3 py-3", !p.activated && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">
                  {displayPhone(p.phone)} {p.is_admin && <Badge tone="violet">admin</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {p.registered ? `Login terakhir ${day(p.last_sign_in_at)}` : "Belum daftar"} · {p.dompets} Dompet
                  {p.note ? ` · ${p.note}` : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--color-brand-600)]"
                  checked={p.activated}
                  disabled={p.is_admin}
                  onChange={(e) =>
                    attempt(async () => (await cloud.setPhoneActive(p.phone, e.target.checked), await reload()), e.target.checked ? "Diaktifkan" : "Dinonaktifkan")
                  }
                />
                Aktif
              </label>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem("phone") as HTMLInputElement).value;
            if (await attempt(async () => (await cloud.setPhoneActive(input, true), await reload()), "Nomor diaktifkan")) e.currentTarget.reset();
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label="Aktifkan nomor langsung (tanpa kode)">
              <Input name="phone" type="tel" placeholder="0812 3456 7890" />
            </Field>
          </div>
          <Button type="submit" variant="secondary">
            Aktifkan
          </Button>
        </form>
      </Card>
    </div>
  );
}
