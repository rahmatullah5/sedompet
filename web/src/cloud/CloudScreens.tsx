import { useEffect, useState } from "react";
import { cloud, cloudStore } from "./sync";
import { displayPhone, getPendingInvite, getRememberedPhone, getRememberMe, inviteLink, normalizePhone, setMode, setPendingInvite, setRememberMe } from "./client";
import { LineIcon, type LineIconName } from "../components/LineIcon";
import { LoadingLogo } from "../components/LoadingLogo";
import { ROLE_HINT, ROLE_LABEL, type Role } from "../lib/permissions";
import { useCurrent } from "../lib/hooks";
import { WA_ACTIVATE } from "../lib/contact";
import { attempt, Avatar, Badge, Button, Card, Field, Input, toast, MadeBy } from "../components/ui";

function Hero({ subtitle }: { subtitle: string }) {
  return (
    <div className="pop-in text-center">
      <div className="flex justify-center -space-x-3">
        <Avatar emoji="👨" colour="#f47c5a" size={60} />
        <Avatar emoji="👩" colour="#e5689b" size={60} />
        <Avatar emoji="🧑" colour="#4f8ef7" size={60} />
        <Avatar emoji="👧" colour="#f5a524" size={60} />
      </div>
      <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-800">
        Satu dompet,
        <br />
        <span className="text-brand-600">satu keluarga.</span>
      </h1>
      <p className="mx-auto mt-3 max-w-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

export function CloudLoading() {
  return (
    <div role="status" className="flex min-h-screen flex-col items-center justify-center gap-4 text-slate-500">
      <LoadingLogo />
      <p className="text-sm font-semibold">Menyiapkan dompet keluarga…</p>
      <div className="ll-bar" />
    </div>
  );
}

/** Phone number + 6-digit PIN. First time: "Daftar" (number must be activated by the admin). */
export function CloudSignIn() {
  const invited = getPendingInvite();
  const [tab, setTab] = useState<"masuk" | "daftar">(invited ? "daftar" : "masuk");
  const [code, setCode] = useState(invited?.code ?? "");
  const [nick, setNick] = useState(invited?.name ?? "");
  const [phone, setPhone] = useState(getRememberedPhone);
  const [remember, setRemember] = useState(getRememberMe);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const pinOk = /^\d{6}$/.test(pin) && (tab === "masuk" || pin === pin2);
  const pinInput = (value: string, set: (v: string) => void, label: string, auto: string) => (
    <Field label={label}>
      <Input
        type="password"
        inputMode="numeric"
        autoComplete={auto}
        maxLength={6}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="••••••"
        className="text-center !text-2xl font-extrabold tracking-[0.5em]"
      />
      <span className="mt-2 flex justify-center gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={`${i}-${i < value.length}`} className={i < value.length ? "dot-pop h-2.5 w-2.5 rounded-full bg-brand-600" : "h-2.5 w-2.5 rounded-full bg-slate-200"} />
        ))}
      </span>
    </Field>
  );
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-10">
      <Hero subtitle="Masuk dengan nomor HP supaya seluruh keluarga melihat dompet yang sama dari HP masing-masing." />
      <Card className="pop-in">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1">
          {(["masuk", "daftar"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => (setTab(t), setPin(""), setPin2(""))}
              className={`rounded-full py-2 text-sm font-bold transition ${tab === t ? "bg-white shadow-sm" : "text-slate-500"}`}
            >
              {t === "masuk" ? "Masuk" : "Daftar pertama kali"}
            </button>
          ))}
        </div>
        <form
          key={shake}
          className={shake ? "shake space-y-3" : "space-y-3"}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            // Joined automatically once signed in (see joinPendingInvite in sync.ts).
            const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
            // 6 chars = Dompet invite, 8 chars = single-use activation code.
            const validCode = cleaned.length === 6 || cleaned.length === 8 ? cleaned : undefined;
            // Sign-up redeems the code on the server; existing users join after login.
            setPendingInvite(tab === "masuk" && validCode?.length === 6 ? { code: validCode, name: nick.trim() || undefined } : null);
            // Must be set before signing in: it decides where the session is stored.
            setRememberMe(remember, phone.trim());
            const ok = await attempt(
              () => (tab === "masuk" ? cloud.signInPhone(phone, pin) : cloud.signUpPhone(phone, pin, validCode, nick.trim())),
              tab === "masuk" ? "Berhasil masuk" : "Akun dibuat",
            );
            if (!ok) setShake((n) => n + 1);
            setBusy(false);
          }}
        >
          <Field label="Nomor HP" hint={phone && !normalizePhone(phone) ? "Contoh: 0812 3456 7890" : undefined}>
            <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812 3456 7890" className="!text-lg font-semibold" />
          </Field>
          {pinInput(pin, setPin, tab === "masuk" ? "PIN (6 angka)" : "Buat PIN (6 angka)", tab === "masuk" ? "current-password" : "new-password")}
          {tab === "daftar" && pinInput(pin2, setPin2, "Ulangi PIN", "new-password")}
          {tab === "daftar" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kode undangan / aktivasi" hint="Dengan kode, nomor langsung aktif.">
                <Input
                  value={code}
                  maxLength={10}
                  placeholder="ABC123"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="text-center font-extrabold tracking-[0.25em]"
                />
              </Field>
              <Field label="Nama panggilan" hint="mis. Ibu, Kakak">
                <Input value={nick} maxLength={40} placeholder="Ibu" onChange={(e) => setNick(e.target.value)} />
              </Field>
            </div>
          )}
          {tab === "masuk" && code.replace(/[^A-Za-z0-9]/g, "").length === 6 && (
            <p className="flex items-start justify-between gap-2 rounded-2xl bg-brand-50 px-3 py-2 text-sm text-brand-800">
              <span>
                Ada undangan (<b className="tracking-wider">{code.toUpperCase()}</b>). Setelah masuk, kamu langsung bergabung.
              </span>
              <button
                type="button"
                onClick={() => {
                  setCode("");
                  setPendingInvite(null);
                }}
                className="shrink-0 text-xs font-semibold text-slate-500 underline underline-offset-2"
              >
                Abaikan
              </button>
            </p>
          )}
          {tab === "daftar" && pin2.length === 6 && pin !== pin2 && <p className="text-sm text-red-600">PIN tidak sama.</p>}
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand-600)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Ingat saya di perangkat ini
              <span className="block text-xs text-slate-500">
                {remember ? "Tetap masuk dan nomor HP diisi otomatis. PIN tidak disimpan." : "Keluar otomatis saat browser/aplikasi ditutup. Cocok untuk HP orang lain."}
              </span>
            </span>
          </label>
          <Button type="submit" className="w-full" disabled={busy || !normalizePhone(phone) || !pinOk}>
            {busy ? "Sebentar…" : tab === "masuk" ? "Masuk" : "Daftar"}
          </Button>
          {tab === "daftar" && (
            <p className="text-center text-xs text-slate-500">
              Punya kode undangan? Nomormu langsung aktif. Tanpa kode, nomor harus diaktifkan admin dulu.{" "}
              <a href={WA_ACTIVATE(normalizePhone(phone) ? displayPhone(normalizePhone(phone)) : undefined)} target="_blank" rel="noopener" className="font-semibold text-[#128C7E] underline underline-offset-2">
                Minta aktivasi via WhatsApp
              </a>
              . Tidak ada SMS.
            </p>
          )}
        </form>
      </Card>
      <button className="text-center text-sm font-semibold text-slate-500 underline-offset-4 hover:underline" onClick={() => setMode("demo")}>
        Coba dulu tanpa akun (demo offline) →
      </button>
      <MadeBy className="text-center" />
    </div>
  );
}

/** Logged in, but the admin hasn't activated (or has deactivated) this number. */
export function CloudNotActivated() {
  const { email, error } = cloudStore.get();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <LineIcon name="clock" size={52} className="text-slate-400" />
      <h1 className="text-2xl font-extrabold text-slate-800">Nomor belum aktif</h1>
      <p className="text-slate-500">
        {displayPhone(email)} belum diaktifkan. {error ?? ""} Minta admin Sedompet mengaktifkan nomormu, lalu coba lagi.
      </p>
      <a href={WA_ACTIVATE(displayPhone(email))} target="_blank" rel="noopener" className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1ebe5a]">
        Minta aktivasi via WhatsApp
      </a>
      <div className="flex gap-2">
        <Button onClick={() => location.reload()}>Coba lagi</Button>
        <Button variant="secondary" onClick={() => cloud.signOut()}>
          Keluar
        </Button>
      </div>
    </div>
  );
}

/** Signed in but not in any Dompet yet: choose to create one, or join with a code. */
export function CloudOnboard() {
  const { email } = cloudStore.get();
  const [choice, setChoice] = useState<"create" | "join" | null>(null);
  const option = (key: "create" | "join", icon: LineIconName, title: string, text: string, primary: boolean) => (
    <button
      onClick={() => setChoice(key)}
      className={`pop-in group flex w-full items-center gap-4 rounded-3xl p-5 text-left transition hover:-translate-y-0.5 ${
        primary ? "bg-brand-600 text-white" : "bg-white shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]"
      }`}
    >
      <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${primary ? "bg-white/20" : "bg-brand-50 text-brand-700"}`}>
        <LineIcon name={icon} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-lg font-bold ${primary ? "" : "text-slate-800"}`}>{title}</span>
        <span className={`block text-sm ${primary ? "text-brand-100" : "text-slate-500"}`}>{text}</span>
      </span>
      <span className={`text-2xl transition group-hover:translate-x-1 ${primary ? "" : "text-slate-300"}`}>›</span>
    </button>
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-5 py-10">
      <div className="text-center">
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-800">Selamat datang!</h1>
        <p className="mt-1 text-sm text-slate-500">Masuk sebagai {displayPhone(email)}</p>
      </div>

      {choice === null && (
        <>
          <p className="text-center font-semibold text-slate-700">Mau mulai dari mana?</p>
          {option("create", "home", "Buat Dompet baru", "Kamu yang memulai. Nanti bisa undang keluarga.", true)}
          {option("join", "people", "Gabung Dompet keluarga", "Sudah diajak? Punya kode undangan 6 huruf dari keluarga.", false)}
        </>
      )}

      {choice !== null && (
        <Card className="pop-in">
          <button onClick={() => setChoice(null)} className="mb-3 text-sm font-semibold text-brand-700">
            ← Kembali
          </button>
          <p className="mb-1 text-lg font-bold text-slate-800">{choice === "create" ? "Buat Dompet baru" : "Gabung Dompet keluarga"}</p>
          <p className="mb-4 text-sm text-slate-500">
            {choice === "create"
              ? "Beri nama dompetnya. Kamu jadi pemilik dan bisa mengundang keluarga setelah ini."
              : "Masukkan kode undangan yang dikirim keluargamu, mis. lewat WhatsApp."}
          </p>
          {choice === "create" ? <CreateForm /> : <JoinForm />}
        </Card>
      )}

      <button className="text-center text-sm font-semibold text-slate-500" onClick={() => cloud.signOut()}>
        Keluar
      </button>
    </div>
  );
}

export function CreateForm({ onDone }: { onDone?: () => void }) {
  const [name, setName] = useState("Keluarga Kita");
  const [you, setYou] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await attempt(() => cloud.createDompet(name, you), "Dompet dibuat")) onDone?.();
        setBusy(false);
      }}
    >
      <Field label="Nama Dompet">
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Kamu dipanggil apa?">
        <Input value={you} maxLength={40} placeholder="mis. Ayah, Bunda" onChange={(e) => setYou(e.target.value)} />
      </Field>
      <Button type="submit" className="w-full" disabled={busy || !name.trim() || !you.trim()}>
        {busy ? "Membuat…" : "Buat Dompet"}
      </Button>
    </form>
  );
}

export function JoinForm({ onDone }: { onDone?: () => void }) {
  const [code, setCode] = useState("");
  const [you, setYou] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await attempt(() => cloud.joinWithCode(code, you), "Berhasil bergabung")) onDone?.();
        setBusy(false);
      }}
    >
      <Field label="Kode undangan">
        <Input value={code} maxLength={8} placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase())} className="text-center !text-2xl font-extrabold tracking-[0.3em]" />
      </Field>
      <Field label="Kamu dipanggil apa?">
        <Input value={you} maxLength={40} placeholder="mis. Ibu, Kakak" onChange={(e) => setYou(e.target.value)} />
      </Field>
      <Button type="submit" variant="secondary" className="w-full" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length !== 6}>
        {busy ? "Bergabung…" : "Gabung"}
      </Button>
    </form>
  );
}

/** Owner/admin: create and share invite codes. */
export function InviteCard() {
  const { dompet, me } = useCurrent();
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof cloud.listInvites>>>([]);
  const reload = () => cloud.listInvites(dompet.id).then(setInvites, () => setInvites([]));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dompet.id]);
  const roles: Exclude<Role, "owner">[] = me.role === "owner" ? ["admin", "member", "viewer"] : ["member", "viewer"];

  const share = async (code: string) => {
    const text = `Yuk gabung Dompet "${dompet.name}" di Sedompet!\n${inviteLink(code)}\nKode undangan: ${code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast("Undangan disalin. Tempel di WhatsApp keluarga.");
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <Card title="Undang keluarga">
      <p className="mb-3 text-sm text-slate-500">Buat kode, kirim lewat WhatsApp. Kode berlaku 7 hari untuk sampai 10 orang.</p>
      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <Button
            key={r}
            variant="secondary"
            title={ROLE_HINT[r]}
            onClick={() =>
              attempt(async () => {
                const inv = await cloud.createInvite(dompet.id, r);
                await reload();
                await share(inv.code);
              })
            }
          >
            + Undang sebagai {ROLE_LABEL[r]}
          </Button>
        ))}
      </div>
      {invites.length > 0 && (
        <ul className="mt-4 space-y-2">
          {invites.map((i) => (
            <li key={i.code} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
              <span className="num text-xl font-extrabold tracking-[0.25em] text-slate-800">{i.code}</span>
              <span className="flex-1 text-xs text-slate-500">
                <Badge>{ROLE_LABEL[i.role]}</Badge> {i.uses}/{i.max_uses} dipakai
              </span>
              <Button variant="ghost" className="px-2" onClick={() => share(i.code)}>
                Bagikan
              </Button>
              <Button variant="ghost" className="px-2 text-red-600" onClick={() => attempt(async () => (await cloud.revokeInvite(i.code), await reload()), "Kode dibatalkan")}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Header avatar sheet in cloud mode. */
export function AccountSheet({ onClose }: { onClose: () => void }) {
  const { email, syncing, error } = cloudStore.get();
  const { dompet, me } = useCurrent();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar emoji={me.emoji} colour={me.colour} size={52} />
        <div>
          <p className="font-bold text-slate-800">{me.name}</p>
          <p className="text-sm text-slate-500">{displayPhone(email)}</p>
          <p className="text-xs text-slate-400">
            {ROLE_LABEL[me.role]} di {dompet.name}
          </p>
        </div>
      </div>
      <p className={`rounded-2xl px-4 py-2.5 text-sm ${error ? "bg-red-50 text-red-700" : "bg-mint-100 text-slate-700"}`}>
        {error ? error : syncing ? "Menyinkronkan…" : "Tersinkron dengan keluarga"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => (onClose(), (location.hash = "/keluarga"))}>
          Ubah nama & emoji
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const pin = prompt("PIN baru (6 angka):");
            if (pin) void attempt(() => cloud.changePin(pin.trim()), "PIN diganti");
          }}
        >
          Ganti PIN
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (confirm("Keluar dari akun di perangkat ini?")) {
              onClose();
              void cloud.signOut();
            }
          }}
        >
          Keluar
        </Button>
      </div>
    </div>
  );
}
