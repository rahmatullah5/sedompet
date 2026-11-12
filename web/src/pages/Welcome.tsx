import { useState } from "react";
import { m } from "../db/repo";
import { seedDemo } from "../db/seed";
import { setSession } from "../lib/session";
import { cloudConfigured, setMode } from "../cloud/client";
import { attempt, Avatar, Button, Card, Field, Input } from "../components/ui";

export function Welcome() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-5 py-10">
      <div className="pop-in text-center">
        <div className="flex justify-center -space-x-3">
          <Avatar emoji="👨" colour="#f47c5a" size={64} />
          <Avatar emoji="👩" colour="#e5689b" size={64} />
          <Avatar emoji="🧑" colour="#4f8ef7" size={64} />
          <Avatar emoji="👧" colour="#f5a524" size={64} />
        </div>
        <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-slate-800">
          Satu dompet,
          <br />
          <span className="text-brand-600">satu keluarga.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-slate-500">
          Ayah, Ibu, Kakak, Adik: semua lihat uang keluarga yang sama, catat bersama, dan tahu sisa bulan ini tanpa ribut.
        </p>
      </div>

      <Card className="pop-in bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <p className="text-lg font-bold">Coba dulu dengan Keluarga Santoso</p>
        <p className="mt-1 text-sm text-brand-100">4 anggota, 2 bulan catatan belanja, anggaran dan uang saku anak. Langsung bisa dicoba.</p>
        <Button
          variant="secondary"
          className="mt-4 w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await attempt(async () => {
              const { dompetId, ownerId } = await seedDemo();
              setSession({ dompetId, memberId: ownerId });
            });
            setBusy(false);
          }}
        >
          {busy ? "Menyiapkan…" : "Lihat demo keluarga →"}
        </Button>
      </Card>

      <NewDompetForm />
      {cloudConfigured && (
        <button className="text-center text-sm font-semibold text-brand-700 underline-offset-4 hover:underline" onClick={() => setMode("cloud")}>
          ☁️ Masuk dengan nomor HP supaya sinkron dengan keluarga →
        </button>
      )}
      <p className="text-center text-xs text-slate-400">🔒 Mode demo: data tersimpan di perangkat ini saja.</p>
    </div>
  );
}

export function NewDompetForm({ onDone, bare }: { onDone?: () => void; bare?: boolean }) {
  const [name, setName] = useState("Keluarga Kita");
  const [yourName, setYourName] = useState("");
  const form = (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await attempt(async () => {
          const { dompetId, ownerId } = await m.createDompet(name, yourName, "🙂");
          setSession({ dompetId, memberId: ownerId }, { picked: true });
          onDone?.();
        }, "Dompet dibuat 🎉");
      }}
    >
      <Field label="Nama Dompet">
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Kamu dipanggil apa?">
        <Input value={yourName} maxLength={40} placeholder="mis. Ayah, Bunda, Rina" onChange={(e) => setYourName(e.target.value)} />
      </Field>
      <Button type="submit" variant={bare ? "primary" : "secondary"} className="w-full" disabled={!name.trim() || !yourName.trim()}>
        Buat Dompet
      </Button>
    </form>
  );
  if (bare) return form;
  return (
    <Card className="pop-in">
      <p className="mb-3 font-bold text-slate-800">Atau mulai dompet keluargamu sendiri</p>
      {form}
    </Card>
  );
}
