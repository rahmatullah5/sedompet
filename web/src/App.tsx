import { useEffect, useState, useSyncExternalStore } from "react";
import { getMode } from "./cloud/client";
import { cloudStore } from "./cloud/sync";
import { AccountSheet, CloudLoading, CloudNotActivated, CloudOnboard, CloudSignIn, CreateForm, JoinForm } from "./cloud/CloudScreens";
import { q, type Transaction } from "./db/repo";
import { can } from "./lib/permissions";
import { hasPickedInTab, setSession } from "./lib/session";
import { CurrentContext, useDbVersion, useSession } from "./lib/hooks";
import { Avatar, cx, Modal, toast, Toasts } from "./components/ui";
import { TransactionForm } from "./components/TransactionForm";
import { ProfilePicker } from "./components/ProfilePicker";
import { Home } from "./pages/Home";
import { Transactions } from "./pages/Transactions";
import { Budgets } from "./pages/Budgets";
import { Goals } from "./pages/Goals";
import { Accounts } from "./pages/Accounts";
import { Members } from "./pages/Members";
import { NewDompetForm, Welcome } from "./pages/Welcome";
import { Categories } from "./pages/Categories";
import { Loans } from "./pages/Loans";
import { Recurring } from "./pages/Recurring";
import { Reports } from "./pages/Reports";
import { Menu } from "./pages/Menu";
import { Admin } from "./pages/Admin";
import { Trash } from "./pages/Trash";
import { Patungan } from "./pages/Patungan";
import { Neraca } from "./pages/Neraca";
import { Notifications } from "./pages/Notifications";
import { PlanBanner, READ_ONLY_MESSAGE } from "./components/PlanBanner";
import { setWriteGuard } from "./db/database";
import { setPeriodStartDay } from "./lib/format";
import { useMarketAutoRefresh } from "./lib/market";
import { LineIcon, type LineIconName } from "./components/LineIcon";

const PAGES = ["beranda", "riwayat", "laporan", "menu", "anggaran", "keluarga", "akun", "kategori", "rutin", "pinjaman", "tujuan", "sampah", "patungan", "neraca", "notifikasi", "admin"] as const;
type PageId = (typeof PAGES)[number];

const NAV: { id: PageId; label: string; icon: LineIconName }[] = [
  { id: "beranda", label: "Beranda", icon: "home" },
  { id: "riwayat", label: "Riwayat", icon: "book" },
  { id: "laporan", label: "Laporan", icon: "bars" },
  { id: "menu", label: "Menu", icon: "menu" },
];

function pageFromHash(): PageId {
  const h = location.hash.replace(/^#\/?/, "");
  return (PAGES.find((p) => p === h) ?? "beranda") as PageId;
}

const MODE = getMode();
const noopSubscribe = () => () => {};

export default function App() {
  useDbVersion();
  // Live kurs + stock prices, so foreign-currency and stock balances stay current.
  useMarketAutoRefresh();
  const session = useSession();
  const cloudState = useSyncExternalStore(MODE === "cloud" ? cloudStore.subscribe : noopSubscribe, cloudStore.get);
  const cloudMode = MODE === "cloud";
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [txOpen, setTxOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [newTxDate, setNewTxDate] = useState<string | undefined>(undefined);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [newDompetOpen, setNewDompetOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goTo = (id: string) => {
    location.hash = `/${id}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Resolve the session against what's actually in the database.
  const dompets = q.dompets();
  const dompet = dompets.find((d) => d.id === session.dompetId) ?? dompets[0];
  const members = dompet ? q.members(dompet.id) : [];
  // Budget month boundaries for every page (payday setting of this Dompet).
  setPeriodStartDay(dompet?.period_start_day);
  // Cloud: you are the member row tied to your login. Demo: whoever was picked.
  const me = cloudMode ? members.find((x) => x.user_id === cloudState.userId) : (members.find((x) => x.id === session.memberId) ?? members[0]);

  useEffect(() => {
    const onErr = (e: Event) => toast(`Tidak tersimpan ke server: ${(e as CustomEvent<string>).detail}`, "error");
    const onToast = (e: Event) => toast((e as CustomEvent<string>).detail);
    window.addEventListener("sedompet:sync-error", onErr);
    window.addEventListener("sedompet:toast", onToast);
    return () => {
      window.removeEventListener("sedompet:sync-error", onErr);
      window.removeEventListener("sedompet:toast", onToast);
    };
  }, []);

  useEffect(() => {
    if (dompet && me && (dompet.id !== session.dompetId || me.id !== session.memberId)) {
      setSession({ dompetId: dompet.id, memberId: me.id });
    }
  }, [dompet, me, session.dompetId, session.memberId]);

  useEffect(() => {
    document.title = dompet ? `${dompet.name} · Sedompet` : "Sedompet";
  }, [dompet]);

  // Paid plans (cloud only): an ended plan makes this Dompet read-only.
  const sub = cloudMode && dompet ? cloudState.subs[dompet.id] : undefined;
  const readOnly = !!sub && !sub.isActive;
  useEffect(() => {
    setWriteGuard(readOnly ? () => READ_ONLY_MESSAGE : null);
    return () => setWriteGuard(null);
  }, [readOnly]);

  if (cloudMode && cloudState.status === "loading") return <CloudLoading />;
  if (cloudMode && cloudState.status === "not-activated") return <CloudNotActivated />;
  if (cloudMode && cloudState.status === "signed-out") {
    return (
      <>
        <CloudSignIn />
        <Toasts />
      </>
    );
  }
  if (!dompet || !me) {
    return (
      <>
        {cloudMode ? <CloudOnboard /> : <Welcome />}
        <Toasts />
      </>
    );
  }

  // Demo: a new tab (or right after the demo is created) asks who's using it.
  if (!cloudMode && (!hasPickedInTab() || pickerOpen)) {
    return (
      <>
        <ProfilePicker
          dompetName={dompet.name}
          members={members}
          currentId={hasPickedInTab() ? me.id : undefined}
          onClose={hasPickedInTab() ? () => setPickerOpen(false) : undefined}
        />
        <Toasts />
      </>
    );
  }

  const openTx = (t: Transaction | null, date?: string, bulk = false) => {
    setEditingTx(t);
    setNewTxDate(date);
    setBulkOpen(bulk);
    setTxOpen(true);
  };
  const canAdd = can.addTransaction(me.role) && !readOnly;

  return (
    <CurrentContext.Provider value={{ dompet, me, members }}>
      <div className="mx-auto min-h-screen max-w-2xl px-4 pb-32">
        <header className="flex items-center justify-between gap-3 pb-2 pt-5">
          <button
            onClick={() => setSwitcherOpen(true)}
            className="flex min-w-0 items-center gap-2.5 rounded-full py-1 pl-1 pr-3 text-left transition hover:bg-white/70"
            aria-label="Ganti Dompet"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-xl shadow-sm shadow-brand-600/30">👛</span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-500">Sedompet</span>
              <span className="flex items-center gap-1 truncate font-bold text-slate-800">
                {dompet.name} <span className="text-xs text-slate-400">▾</span>
              </span>
            </span>
          </button>

          <button
            onClick={() => (cloudMode ? setAccountOpen(true) : setPickerOpen(true))}
            className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-[0_4px_14px_-8px_rgba(120,72,40,0.35)] transition hover:shadow-md"
            aria-label={cloudMode ? `Akun ${me.name}` : `Kamu: ${me.name}. Ganti orang`}
          >
            <Avatar emoji={me.emoji} colour={me.colour} size={34} />
            <span className="text-sm font-bold text-slate-700">{me.name}</span>
            {cloudMode && (
              <span
                title={cloudState.error ?? (cloudState.syncing ? "Menyinkronkan" : "Tersinkron")}
                className={cx("h-2 w-2 rounded-full", cloudState.error ? "bg-red-500" : cloudState.syncing ? "animate-pulse bg-sun-400" : "bg-mint-600")}
              />
            )}
          </button>
        </header>

        <main className="pt-2">
          <PlanBanner sub={sub} isOwner={me.role === "owner"} />
          {page === "beranda" && <Home onOpenTx={openTx} goTo={goTo} />}
          {page === "riwayat" && <Transactions onOpenTx={openTx} onAddOnDate={canAdd ? (d) => openTx(null, d) : undefined} onBulk={canAdd ? () => openTx(null, undefined, true) : undefined} />}
          {page === "anggaran" && <Budgets />}
          {page === "tujuan" && <Goals />}
          {page === "keluarga" && <Members />}
          {page === "akun" && <Accounts />}
          {page === "laporan" && <Reports />}
          {page === "menu" && <Menu />}
          {page === "kategori" && <Categories />}
          {page === "rutin" && <Recurring />}
          {page === "pinjaman" && <Loans />}
          {page === "sampah" && <Trash />}
          {page === "patungan" && <Patungan onOpenTx={openTx} />}
          {page === "neraca" && <Neraca />}
          {page === "notifikasi" && <Notifications />}
          {page === "admin" && cloudMode && <Admin />}
        </main>
      </div>

      {/* Floating bottom nav with the big "+" in the middle */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        aria-label="Menu utama"
      >
        <div className="flex w-full max-w-md items-center justify-between rounded-[2rem] bg-white/95 px-3 py-2 shadow-[0_10px_30px_-10px_rgba(120,72,40,0.35)] backdrop-blur">
          {NAV.slice(0, 2).map((n) => (
            <NavItem key={n.id} {...n} active={page === n.id} />
          ))}
          <button
            onClick={() => (canAdd ? openTx(null) : toast(readOnly ? READ_ONLY_MESSAGE : "Peranmu 'Hanya lihat'. Minta orang tua untuk mencatat ya 🙂"))}
            className={cx(
              "-mt-9 flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-4 border-[#fff8f1] text-3xl font-light text-white shadow-lg transition active:scale-95",
              canAdd ? "bg-brand-600 shadow-brand-600/40 hover:bg-brand-700" : "bg-slate-300 shadow-none",
            )}
            aria-label={canAdd ? "Catat transaksi" : "Mode lihat saja"}
          >
            {canAdd ? "+" : <LineIcon name="eye" size={24} />}
          </button>
          {NAV.slice(2).map((n) => (
            <NavItem key={n.id} {...n} active={page === n.id || (n.id === "menu" && !["beranda", "riwayat", "laporan"].includes(page))} />
          ))}
        </div>
      </nav>

      <TransactionForm open={txOpen} onClose={() => setTxOpen(false)} editing={editingTx} initialDate={newTxDate} bulk={bulkOpen} />

      <Modal open={switcherOpen} onClose={() => setSwitcherOpen(false)} title="Dompet kamu">
        <ul className="space-y-2">
          {dompets.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => {
                  setSession({ dompetId: d.id, memberId: null });
                  setSwitcherOpen(false);
                  if (!cloudMode) setPickerOpen(true);
                }}
                className={cx(
                  "flex w-full items-center gap-3 rounded-2xl p-3 text-left transition",
                  d.id === dompet.id ? "bg-brand-50 ring-2 ring-brand-500" : "bg-slate-50 hover:bg-slate-100",
                )}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">👛</span>
                <span className="flex-1">
                  <span className="block font-bold">{d.name}</span>
                  <span className="text-xs text-slate-500">{q.members(d.id).length} anggota</span>
                </span>
                {d.id === dompet.id && <span className="text-brand-600">✓</span>}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            setSwitcherOpen(false);
            setNewDompetOpen(true);
          }}
          className="mt-3 w-full rounded-2xl border-2 border-dashed border-slate-200 p-3 text-sm font-semibold text-slate-600 hover:border-brand-500 hover:text-brand-700"
        >
          + Buat Dompet baru (kos bareng, trip, keluarga besar…)
        </button>
        {cloudMode && (
          <div className="mt-4 rounded-2xl bg-slate-50 p-3">
            <p className="mb-2 text-sm font-bold text-slate-700">Punya kode undangan?</p>
            <JoinForm onDone={() => setSwitcherOpen(false)} />
          </div>
        )}
      </Modal>
      <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title="Akunmu">
        <AccountSheet onClose={() => setAccountOpen(false)} />
      </Modal>

      <Modal open={newDompetOpen} onClose={() => setNewDompetOpen(false)} title="Dompet baru">
        {cloudMode ? <CreateForm onDone={() => setNewDompetOpen(false)} /> : <NewDompetForm bare onDone={() => setNewDompetOpen(false)} />}
      </Modal>
      <Toasts />
    </CurrentContext.Provider>
  );
}

function NavItem({ id, label, icon, active }: { id: string; label: string; icon: LineIconName; active: boolean }) {
  return (
    <a
      href={`#/${id}`}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex w-16 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-semibold transition",
        active ? "text-brand-700" : "text-slate-400 hover:text-slate-600",
      )}
    >
      <LineIcon name={icon} size={22} className={cx("transition", active ? "scale-110" : "")} />
      {label}
    </a>
  );
}
