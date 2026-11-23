import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True when this build has a Supabase project configured. */
export const cloudConfigured = Boolean(url && key);

// "Ingat saya": with it on (default) the login is kept in localStorage and
// survives closing the browser; off, it lives in sessionStorage and ends when
// the browser/app is closed. The PIN itself is never stored.
const REMEMBER_KEY = "sedompet.rememberMe";
const LAST_PHONE_KEY = "sedompet.lastPhone";
const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
export const getRememberMe = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== "0", true);
export function setRememberMe(on: boolean, phone?: string) {
  safe(() => {
    localStorage.setItem(REMEMBER_KEY, on ? "1" : "0");
    if (on && phone) localStorage.setItem(LAST_PHONE_KEY, phone);
    if (!on) localStorage.removeItem(LAST_PHONE_KEY);
  }, undefined);
}
/** Phone number of the last remembered login, to prefill the sign-in form. */
export const getRememberedPhone = () => safe(() => localStorage.getItem(LAST_PHONE_KEY) ?? "", "");

const authStorage = {
  getItem: (k: string) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k: string, v: string) =>
    safe(() => {
      if (getRememberMe()) {
        localStorage.setItem(k, v);
        sessionStorage.removeItem(k);
      } else {
        sessionStorage.setItem(k, v);
        localStorage.removeItem(k);
      }
    }, undefined),
  removeItem: (k: string) =>
    safe(() => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    }, undefined),
};

export const supabase: SupabaseClient | null = cloudConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStorage } })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error("Supabase belum dikonfigurasi.");
  return supabase;
}

// ---------------------------------------------------------------------------
// Which mode this browser runs in: offline demo, or synced with Supabase.
// ---------------------------------------------------------------------------
export type Mode = "demo" | "cloud";
export type Route = "landing" | Mode;

/** The address decides what runs: / = landing page, /demo = offline demo, /app = real app. */
export function getRoute(): Route {
  const path = location.pathname.replace(/\/+$/, "");
  if (path === "/demo") return "demo";
  if (path === "/app") return cloudConfigured ? "cloud" : "demo";
  return "landing";
}

export function getMode(): Mode {
  const r = getRoute();
  return r === "landing" ? (cloudConfigured ? "cloud" : "demo") : r;
}

/** Switch between the offline demo and the real app (full page load). */
export function setMode(mode: Mode) {
  location.href = mode === "demo" ? "/demo" : "/app";
}

/** Friendly messages for errors raised by our Postgres functions/RLS. */
export function friendlyError(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  const map: Record<string, string> = {
    invalid_invite: "Kode undangan salah, kedaluwarsa, atau sudah habis dipakai.",
    forbidden: "Kamu tidak punya izin untuk ini di Dompet ini.",
    last_owner: "Dompet harus punya minimal satu pemilik. Jadikan orang lain pemilik dulu.",
    only_owner_can_invite_admin: "Hanya pemilik yang bisa mengundang admin.",
    "row-level security": "Ditolak server: kamu tidak punya izin untuk perubahan ini.",
    subcategory_too_deep: "Subkategori hanya bisa satu tingkat.",
    "Token has expired or is invalid": "Kode masuk salah atau sudah kedaluwarsa.",
    "rate limit": "Terlalu sering. Tunggu sebentar lalu coba lagi.",
    phone_not_activated: "Nomor ini belum diaktifkan. Hubungi admin Sedompet.",
    phone_already_claimed: "Nomor ini sudah dipakai akun lain. Hubungi admin.",
    phone_already_registered: "Nomor ini sudah terdaftar. Silakan Masuk dengan PIN-mu.",
    invalid_pin: "PIN harus 6 angka.",
    invalid_phone: "Nomor HP tidak valid.",
    invalid_activation_code: "Kode aktivasi salah, sudah dipakai, atau kedaluwarsa.",
    cannot_deactivate_self: "Kamu tidak bisa menonaktifkan nomormu sendiri.",
    subscription_expired: "Langganan Dompet ini sudah berakhir, jadi hanya bisa dilihat. Perpanjang lewat admin untuk mencatat lagi.",
    invalid_plan: "Paket tidak dikenal.",
    invalid_months: "Jumlah bulan harus 1 sampai 36.",
    invalid_split: "Pembagian patungan tidak cocok dengan jumlahnya. Cek lagi bagian tiap orang.",
    already_member: "Nomor ini sudah ada di Dompet ini.",
    name_required: "Isi nama panggilannya.",
    member_not_in_dompet: "Anggota itu tidak ada di Dompet ini.",
    private_needs_member: "Akun pribadi harus punya pemegang.",
    "Could not find the function public.register_phone": "Server belum diperbarui. Admin perlu menjalankan SQL register_phone.",
    "Invalid login credentials": "Nomor atau PIN salah.",
    "User already registered": "Nomor ini sudah terdaftar. Silakan masuk.",
    "Email not confirmed": "Akun belum dikonfirmasi. Admin perlu mematikan 'Confirm email' di Supabase.",
    "Signups not allowed": "Pendaftaran sedang ditutup. Hubungi admin.",
    "Password should be": "PIN minimal 6 angka.",
  };
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v;
  return msg;
}

// ---------------------------------------------------------------------------
// Phone login: Supabase Auth only knows emails, so a phone number maps to a
// synthetic address that never receives mail. Must match phone_from_email()
// in supabase/migrations/20261113000000_phone_login.sql.
// ---------------------------------------------------------------------------
export const PHONE_EMAIL_DOMAIN = "phone.sedompet.app";

/** "0812-3456 789" / "+62 812..." / "812..." -> "62812..." (or "" if not valid). */
export function normalizePhone(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("0")) d = "62" + d.slice(1);
  else if (d.startsWith("8")) d = "62" + d;
  return /^62\d{8,13}$/.test(d) ? d : "";
}

export function phoneEmail(phone: string) {
  return `${phone}@${PHONE_EMAIL_DOMAIN}`;
}

/** "6281234567890" -> "0812-3456-7890" for display. */
export function displayPhone(phoneOrEmail: string | null | undefined) {
  const d = (phoneOrEmail ?? "").split("@")[0];
  if (!/^62\d+$/.test(d)) return phoneOrEmail ?? "";
  const local = "0" + d.slice(2);
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

// ---------------------------------------------------------------------------
// Invite links: https://…/?kode=ABC123 → remembered until the person is
// signed in, then the app joins that Dompet automatically.
// ---------------------------------------------------------------------------
const PENDING_INVITE = "sedompet.pendingInvite";

export function inviteCodeFromUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get("kode");
  const fromHash = location.hash.match(/gabung\/([A-Za-z0-9]{6})/)?.[1];
  const code = (fromQuery ?? fromHash ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 6 || code.length === 8 ? code : null;
}

/** Removes ?kode= from the address bar so a reload doesn't re-trigger it. */
export function stripInviteFromUrl() {
  const url = new URL(location.href);
  if (!url.searchParams.has("kode") && !/gabung\//.test(url.hash)) return;
  url.searchParams.delete("kode");
  if (/gabung\//.test(url.hash)) url.hash = "";
  history.replaceState(null, "", url.toString());
}

export function getPendingInvite(): { code: string; name?: string } | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_INVITE) ?? "null");
  } catch {
    return null;
  }
}

export function setPendingInvite(v: { code: string; name?: string } | null) {
  try {
    if (v) localStorage.setItem(PENDING_INVITE, JSON.stringify(v));
    else localStorage.removeItem(PENDING_INVITE);
  } catch {
    /* ignore */
  }
}

export function inviteLink(code: string) {
  return `${location.origin}/app?kode=${code}`;
}
