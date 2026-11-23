import { Avatar, MadeBy } from "../components/ui";
import { SimulatedPurchases } from "../components/SimulatedPurchases";
import { LineIcon, type LineIconName } from "../components/LineIcon";
import { WA_ACTIVATE, WA_FEEDBACK, WA_SUBSCRIBE } from "../lib/contact";

const FEATURES: { icon: LineIconName; title: string; text: string }[] = [
  { icon: "users", title: "Satu dompet, banyak HP", text: "Ayah catat bensin, Ibu catat belanja dapur. Semua langsung muncul di HP seluruh keluarga." },
  { icon: "shield", title: "Peran yang pas", text: "Orang tua mengatur, anak cukup melihat. Anggota hanya bisa mengubah catatannya sendiri." },
  { icon: "lock", title: "Tetap ada ruang pribadi", text: "Tabungan pribadi hanya terlihat oleh pemiliknya, tidak ikut tercampur ke anggaran keluarga." },
  { icon: "piggy", title: "Anggaran & uang saku", text: "Batas belanja per kategori, anggaran 'semua kecuali cicilan', dan uang saku tiap anak." },
  { icon: "repeat", title: "Tagihan rutin & utang", text: "SPP, Netflix, listrik, gaji. Muncul di Beranda saat jatuh tempo, sekali ketuk langsung tercatat. Pinjam-meminjam tercatat rapi." },
  { icon: "bars", title: "Laporan & perkiraan", text: "Ke mana uang pergi, laju belanja bulan ini, dan perkiraan saldo 3 bulan ke depan." },
];

const STEPS = [
  { n: "1", title: "Daftar pakai nomor HP", text: "Masukkan kode aktivasi atau undangan, lalu buat PIN 6 angka. Tanpa SMS, tanpa email." },
  { n: "2", title: "Undang keluarga", text: "Bagikan kode lewat WhatsApp. Pilih perannya: admin, anggota, atau hanya lihat." },
  { n: "3", title: "Catat bersama", text: "Tekan ＋, ketik jumlah, pilih kategori. Seluruh keluarga langsung tahu sisa bulan ini." },
];

function PhoneMock() {
  return (
    <div className="relative mx-auto w-[300px] rounded-[2.5rem] border-[10px] border-slate-800 bg-[#fff8f1] p-4 shadow-[0_30px_60px_-20px_rgba(120,72,40,0.45)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">Selamat pagi, Ibu</span>
        <Avatar emoji="👩" colour="#e5689b" size={28} />
      </div>
      <div className="rounded-3xl bg-brand-600 p-4 text-white">
        <p className="text-[11px] text-brand-100">Uang keluarga sekarang</p>
        <p className="num text-2xl font-extrabold">Rp 12.480.000</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <span className="rounded-xl bg-white/15 px-2 py-1.5">
            Masuk <b className="block text-sm">+20,5 jt</b>
          </span>
          <span className="rounded-xl bg-white/15 px-2 py-1.5">
            Keluar <b className="block text-sm">−8,1 jt</b>
          </span>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-white p-3 text-[12px] shadow-sm">
        <p><b>Masih aman!</b> Sisa Rp 3,9 jt, kira-kira Rp 260 rb per hari.</p>
        <div className="mt-2 h-2 rounded-full bg-slate-100">
          <div className="h-2 w-2/3 rounded-full bg-[#2fb67c]" />
        </div>
      </div>
      <div className="mt-3 space-y-2 text-[12px]">
        <div className="flex items-end gap-2">
          <Avatar emoji="👨" colour="#f47c5a" size={24} />
          <p className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5">
            <b>Ayah</b> mencatat bensin Rp 50.000
          </p>
        </div>
        <div className="flex flex-row-reverse items-end gap-2">
          <Avatar emoji="👩" colour="#e5689b" size={24} />
          <p className="rounded-2xl rounded-br-md bg-brand-100 px-3 py-1.5 text-brand-800">
            <b>Kamu</b> mencatat belanja dapur Rp 186.000
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Avatar emoji="🧑" colour="#4f8ef7" size={24} />
          <p className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5">
            <b>Kakak</b> membayar SPP Rp 750.000
          </p>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-20 bg-[#fff8f1]/85 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3" aria-label="Utama">
          <a href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-sm shadow-brand-600/30">
              <LineIcon name="wallet" size={20} />
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-800">Sedompet</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-slate-600 md:flex">
            <a href="#fitur" className="hover:text-brand-700">Fitur</a>
            <a href="#cara" className="hover:text-brand-700">Cara kerja</a>
            <a href="#pindahan" className="hover:text-brand-700">Pindahan</a>
            <a href="#harga" className="hover:text-brand-700">Harga</a>
          </div>
          <div className="flex items-center gap-2">
            <a href="/demo" className="hidden rounded-full px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white sm:inline-block">
              Coba demo
            </a>
            <a href="/app" className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700">
              Masuk
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-10 md:grid-cols-2 md:pt-16">
        <div className="pop-in">
          <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700 shadow-sm">
            Untuk keluarga & teman Indonesia
          </p>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-800 sm:text-5xl md:text-6xl">
            Satu dompet,
            <br />
            <span className="text-brand-600">satu keluarga.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg text-slate-600">
            Catat pengeluaran bersama dari HP masing-masing. Semua orang di rumah tahu sisa uang bulan ini, tanpa ribut, tanpa tebak-tebakan.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/demo" className="rounded-full bg-brand-600 px-6 py-3.5 font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-[0.98]">
              Coba demo, gratis →
            </a>
            <a href="/app" className="rounded-full bg-white px-6 py-3.5 font-semibold text-slate-800 shadow-sm transition hover:shadow-md">
              Masuk / Daftar
            </a>
          </div>
          <p className="mt-4 text-sm text-slate-500">Demo berjalan di browser, tanpa daftar. Ada contoh “Keluarga Santoso” lengkap.</p>
        </div>
        <div className="pop-in">
          <PhoneMock />
        </div>
      </section>

      {/* Problem → solution */}
      <section className="mx-auto max-w-4xl px-5 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl bg-white/70 p-6">
            <p className="text-sm font-bold text-slate-500">Biasanya…</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-600 marker:text-slate-400">
              <li>Tiap orang punya aplikasi & catatan sendiri</li>
              <li>“Bulan ini uangnya ke mana ya?”</li>
              <li>Rekap di grup WA yang tenggelam</li>
            </ul>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
            <p className="text-sm font-bold text-brand-700">Dengan Sedompet</p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700 marker:text-brand-600">
              <li>Satu dompet untuk seluruh keluarga</li>
              <li>Catatan siapa pun langsung terlihat</li>
              <li>Sisa uang per hari, dalam bahasa sehari-hari</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="fitur" className="scroll-mt-20 bg-white/60 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-800">Semua yang dibutuhkan keluarga</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">Bukan cuma untuk berdua: satu akun bisa punya Dompet keluarga, kos bareng, sampai trip bareng teman.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
                <span className="block text-slate-700">
                  <LineIcon name={f.icon} size={32} />
                </span>
                <h3 className="mt-3 text-lg font-bold text-slate-800">{f.title}</h3>
                <p className="mt-1 text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="cara" className="mx-auto max-w-5xl scroll-mt-20 px-5 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-800">Mulai dalam 3 langkah</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-lg font-extrabold text-white">{s.n}</span>
              <h3 className="mt-4 text-lg font-bold text-slate-800">{s.title}</h3>
              <p className="mt-1 text-slate-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Moving from another app */}
      <section id="pindahan" className="mx-auto max-w-5xl scroll-mt-20 px-5 pb-16">
        <div className="flex flex-col items-start gap-5 rounded-[2rem] bg-sun-100 p-8 md:flex-row md:items-center">
          <span className="text-slate-700">
            <LineIcon name="box" size={44} />
          </span>
          <div className="flex-1">
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-800">Pindahan dari aplikasi lain? Bawa semua datamu.</h2>
            <p className="mt-1 text-slate-600">
              Akun, kategori & subkategori, ribuan transaksi, transfer, koreksi saldo, pinjaman, dan anggaran. Diproses di browser, file tidak dikirim ke mana pun.
            </p>
          </div>
          <a href="/demo" className="shrink-0 rounded-full bg-slate-800 px-5 py-3 font-semibold text-white hover:bg-slate-700">
            Coba impor di demo
          </a>
        </div>
      </section>

      <Pricing />

      {/* Trust */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="grid gap-4 text-center sm:grid-cols-2 lg:grid-cols-4">
          {([
            ["lock", "Data per keluarga", "Hanya anggota Dompet yang bisa melihat. Dijaga langsung oleh database."],
            ["phone", "Tetap jalan saat sinyal hilang", "Pasang di layar utama HP. Data tersimpan di HP dan tersinkron lagi saat online."],
            ["download", "Datamu bisa dibawa pulang", "Unduh transaksi ke Excel / Google Sheets kapan saja. Salah hapus? Pulihkan dari Sampah."],
            ["shield", "Tanpa iklan", "Uang keluargamu bukan bahan jualan."],
          ] as [LineIconName, string, string][]).map(([icon, title, text]) => (
            <div key={title} className="rounded-3xl bg-white/70 p-6">
              <span className="flex justify-center text-slate-700">
                <LineIcon name={icon} size={28} />
              </span>
              <p className="mt-2 font-bold text-slate-800">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 pb-20">
        <div className="mx-auto max-w-4xl rounded-[2.5rem] bg-brand-600 px-8 py-12 text-center text-white shadow-[0_24px_50px_-20px_rgba(212,80,46,0.7)]">
          <div className="flex justify-center">
            <LineIcon name="people" size={44} />
          </div>
          <h2 className="mt-5 text-3xl font-extrabold tracking-tight">Yuk, satukan dompet keluarga.</h2>
          <p className="mx-auto mt-2 max-w-md text-brand-100">Coba demonya dulu, tidak perlu daftar. Kalau cocok, masuk dengan nomor HP dan undang keluarga.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <a href="/demo" className="rounded-full bg-white px-6 py-3.5 font-semibold text-brand-700 hover:bg-brand-50">
              Coba demo →
            </a>
            <a href="/app" className="rounded-full bg-white/15 px-6 py-3.5 font-semibold text-white ring-1 ring-white/40 hover:bg-white/25">
              Masuk / Daftar
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200/70 py-8 text-center text-sm text-slate-500">
        <p>Sedompet · Satu dompet untuk keluarga</p>
        <MadeBy className="mt-2 text-sm" />
        <p className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
          <a href={WA_ACTIVATE()} target="_blank" rel="noopener" className="font-semibold text-[#128C7E] hover:underline">
            Minta aktivasi nomor
          </a>
          <a href={WA_FEEDBACK} target="_blank" rel="noopener" className="font-semibold text-[#128C7E] hover:underline">
            Kirim masukan via WhatsApp
          </a>
        </p>
        <p className="mt-1 text-xs text-slate-400">Open source (GPL-3.0).</p>
      </footer>
      <SimulatedPurchases />
    </div>
  );
}

const PLAN_INCLUDES = [
  "Satu langganan untuk seluruh keluarga. Ayah, Ibu, anak, semua ikut tanpa biaya tambahan",
  "Buat Dompet sebanyak apa pun: keluarga, kos bareng, trip bareng teman",
  "Semua fitur, termasuk update baru selama berlangganan",
  "Sinkron di semua HP & laptop, tetap jalan saat sinyal hilang",
  "Unduh datamu ke Excel kapan saja, juga setelah berhenti langganan",
];

function PlanButton({ plan, primary, children }: { plan: "bulanan" | "tahunan"; primary?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={WA_SUBSCRIBE(plan)}
      target="_blank"
      rel="noopener"
      className={
        primary
          ? "block rounded-full bg-brand-600 px-6 py-3.5 text-center font-semibold text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700 active:scale-[0.98]"
          : "block rounded-full bg-brand-50 px-6 py-3.5 text-center font-semibold text-brand-800 transition hover:bg-brand-100 active:scale-[0.98]"
      }
    >
      {children}
    </a>
  );
}

/** Promo prices (monthly / yearly) vs the normal monthly price that comes later. */
function Pricing() {
  return (
    <section id="harga" className="mx-auto max-w-5xl scroll-mt-20 px-5 pb-16">
      <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-800">Sehari lebih murah dari sepotong gorengan</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">
        Harga promo untuk keluarga pertama Sedompet. Setelah promo selesai, harga normalnya <b className="num text-slate-700">Rp50.000/bulan</b>.
      </p>

      <div className="mt-10 grid items-stretch gap-4 md:grid-cols-2">
        {/* Monthly promo */}
        <div className="flex flex-col rounded-[2rem] bg-white p-7 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Bulanan</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="num text-5xl font-extrabold tracking-tight text-slate-800">Rp10.000</span>
            <span className="pb-1.5 text-slate-500">/bulan</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <s className="num">Rp50.000</s> · hemat 80% selama promo
          </p>
          <div className="mt-5 space-y-2">
            <Relatable>Seharga 2 gelas es teh manis, untuk sebulan penuh</Relatable>
            <Relatable>≈ Rp333/hari untuk seluruh keluarga</Relatable>
          </div>
          <div className="mt-auto pt-6">
            <PlanButton plan="bulanan">Pilih Bulanan</PlanButton>
          </div>
        </div>

        {/* Yearly promo (best value) */}
        <div className="relative flex flex-col rounded-[2rem] bg-white p-7 shadow-[0_24px_50px_-24px_rgba(212,80,46,0.55)] ring-2 ring-brand-500">
          <span className="absolute -top-3 left-7 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white shadow-sm">Paling hemat</span>
          <p className="text-sm font-bold uppercase tracking-wide text-brand-700">Tahunan</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-1">
            <span className="num text-5xl font-extrabold tracking-tight text-slate-800">Rp99.000</span>
            <span className="pb-1.5 text-slate-500">/12 bulan</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            <s className="num">Rp600.000</s> · cuma <b className="num text-slate-700">Rp8.250/bulan</b>, gratis 2 bulan dibanding Bulanan
          </p>
          <div className="mt-5 space-y-2">
            <Relatable>Setara 2 gelas kopi susu kekinian, untuk setahun penuh</Relatable>
            <Relatable>≈ Rp271/hari, lebih murah dari parkir motor</Relatable>
          </div>
          <div className="mt-auto pt-6">
            <PlanButton plan="tahunan" primary>
              Pilih Tahunan Rp99.000 →
            </PlanButton>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[2rem] bg-white/60 p-6">
        <p className="font-bold text-slate-800">Semua paket sudah termasuk:</p>
        <ul className="mt-3 grid gap-2 text-slate-700 sm:grid-cols-2">
          {PLAN_INCLUDES.map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-mint-600">✓</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Bayar lewat transfer bank / QRIS ke admin di WhatsApp. Kode aktivasi dikirim setelah pembayaran diterima.{" "}
          <a href="/demo" className="font-semibold text-brand-700 hover:underline">
            Coba demo dulu, gratis →
          </a>
        </p>
      </div>
    </section>
  );
}

function Relatable({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-sun-100/70 px-3 py-2.5 text-sm text-slate-700">
      {children}
    </div>
  );
}
