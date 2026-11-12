import { Avatar, MadeBy } from "../components/ui";

const FEATURES = [
  { icon: "👨‍👩‍👧", title: "Satu dompet, banyak HP", text: "Ayah catat bensin, Ibu catat belanja dapur. Semua langsung muncul di HP seluruh keluarga." },
  { icon: "🛡️", title: "Peran yang pas", text: "Orang tua mengatur, anak cukup melihat. Anggota hanya bisa mengubah catatannya sendiri." },
  { icon: "🔒", title: "Tetap ada ruang pribadi", text: "Tabungan pribadi hanya terlihat oleh pemiliknya, tidak ikut tercampur ke anggaran keluarga." },
  { icon: "🐷", title: "Anggaran & uang saku", text: "Batas belanja per kategori, anggaran 'semua kecuali cicilan', dan uang saku tiap anak." },
  { icon: "🔁", title: "Tagihan rutin & utang", text: "SPP, Netflix, listrik, gaji. Diingatkan saat jatuh tempo. Pinjam-meminjam tercatat rapi." },
  { icon: "🔮", title: "Laporan & perkiraan", text: "Ke mana uang pergi, laju belanja bulan ini, dan perkiraan saldo 3 bulan ke depan." },
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
        <span className="text-sm font-bold text-slate-800">Selamat pagi, Ibu 👋</span>
        <Avatar emoji="👩" colour="#e5689b" size={28} />
      </div>
      <div className="rounded-3xl bg-gradient-to-br from-brand-500 to-brand-700 p-4 text-white">
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
        <p>😊 <b>Masih aman!</b> Sisa Rp 3,9 jt, kira-kira Rp 260 rb per hari.</p>
        <div className="mt-2 h-2 rounded-full bg-slate-100">
          <div className="h-2 w-2/3 rounded-full bg-[#2fb67c]" />
        </div>
      </div>
      <div className="mt-3 space-y-2 text-[12px]">
        <div className="flex items-end gap-2">
          <Avatar emoji="👨" colour="#f47c5a" size={24} />
          <p className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5">
            <b>Ayah</b> mencatat bensin Rp 50.000 🛵
          </p>
        </div>
        <div className="flex flex-row-reverse items-end gap-2">
          <Avatar emoji="👩" colour="#e5689b" size={24} />
          <p className="rounded-2xl rounded-br-md bg-brand-100 px-3 py-1.5 text-brand-800">
            <b>Kamu</b> mencatat belanja dapur Rp 186.000 🛒
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Avatar emoji="🧑" colour="#4f8ef7" size={24} />
          <p className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-1.5">
            <b>Kakak</b> membayar SPP Rp 750.000 🎒
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
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-600 text-lg shadow-sm shadow-brand-600/30">👛</span>
            <span className="text-lg font-extrabold tracking-tight text-slate-800">Sedompet</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-slate-600 md:flex">
            <a href="#fitur" className="hover:text-brand-700">Fitur</a>
            <a href="#cara" className="hover:text-brand-700">Cara kerja</a>
            <a href="#pindahan" className="hover:text-brand-700">Pindahan</a>
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
            🇮🇩 Untuk keluarga & teman Indonesia
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
            <ul className="mt-3 space-y-2 text-slate-600">
              <li>😩 Tiap orang punya aplikasi & catatan sendiri</li>
              <li>🤷 “Bulan ini uangnya ke mana ya?”</li>
              <li>📒 Rekap di grup WA yang tenggelam</li>
            </ul>
          </div>
          <div className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
            <p className="text-sm font-bold text-brand-700">Dengan Sedompet</p>
            <ul className="mt-3 space-y-2 text-slate-700">
              <li>👛 Satu dompet untuk seluruh keluarga</li>
              <li>⚡ Catatan siapa pun langsung terlihat</li>
              <li>😊 Sisa uang per hari, dalam bahasa sehari-hari</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="fitur" className="scroll-mt-20 bg-white/60 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-slate-800">Semua yang dibutuhkan keluarga</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-slate-500">Dibuat untuk rumah tangga, kos bareng, sampai trip bareng teman.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-3xl bg-white p-6 shadow-[0_8px_24px_-14px_rgba(120,72,40,0.3)]">
                <span className="text-4xl">{f.icon}</span>
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
          <span className="text-5xl">📦</span>
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

      {/* Trust */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="grid gap-4 text-center sm:grid-cols-3">
          {[
            ["🔐", "Data per keluarga", "Hanya anggota Dompet yang bisa melihat. Dijaga langsung oleh database."],
            ["📴", "Tetap jalan saat sinyal hilang", "Data tersimpan di HP dan tersinkron lagi saat online."],
            ["🙅", "Tanpa iklan", "Uang keluargamu bukan bahan jualan."],
          ].map(([icon, title, text]) => (
            <div key={title} className="rounded-3xl bg-white/70 p-6">
              <span className="text-3xl">{icon}</span>
              <p className="mt-2 font-bold text-slate-800">{title}</p>
              <p className="mt-1 text-sm text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 pb-20">
        <div className="mx-auto max-w-4xl rounded-[2.5rem] bg-gradient-to-br from-brand-500 to-brand-700 px-8 py-12 text-center text-white shadow-[0_24px_50px_-20px_rgba(212,80,46,0.7)]">
          <div className="flex justify-center -space-x-3">
            <Avatar emoji="👨" colour="#fff" size={52} />
            <Avatar emoji="👩" colour="#fff" size={52} />
            <Avatar emoji="🧑" colour="#fff" size={52} />
            <Avatar emoji="👧" colour="#fff" size={52} />
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
        <p>👛 Sedompet · Satu dompet untuk keluarga</p>
        <MadeBy className="mt-2 text-sm" />
        <p className="mt-1 text-xs text-slate-400">Open source (GPL-3.0).</p>
      </footer>
    </div>
  );
}
