// Role rules for a shared Dompet. Mirrors the Postgres RLS / RPC rules in
// supabase/migrations so the demo behaves like the real backend will.

export type Role = "owner" | "admin" | "member" | "viewer";

export const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Pemilik",
  admin: "Admin",
  member: "Anggota",
  viewer: "Hanya lihat",
};

export const ROLE_HINT: Record<Role, string> = {
  owner: "Kontrol penuh, bisa hapus Dompet",
  admin: "Kelola anggota, akun, kategori, anggaran",
  member: "Catat transaksi, ubah catatan sendiri",
  viewer: "Hanya bisa melihat (cocok untuk anak)",
};

export const can = {
  addTransaction: (r: Role) => r !== "viewer",
  /** Admins edit anything; members edit their own entries and anything in an account they hold. */
  editTransaction: (r: Role, isMine: boolean, holdsAccount = false) =>
    r === "owner" || r === "admin" || (r === "member" && (isMine || holdsAccount)),
  manage: (r: Role) => r === "owner" || r === "admin",
  /** Private accounts: any non-viewer can make one for themselves. */
  addPrivateAccount: (r: Role) => r !== "viewer",
  /** Which roles `actor` may assign to someone currently holding `target`. */
  assignableRoles(actor: Role, target: Role): Role[] {
    if (actor === "owner") return ROLES;
    if (actor === "admin" && (target === "member" || target === "viewer"))
      return ["member", "viewer"];
    return [];
  },
  removeMember(actor: Role, target: Role, isSelf: boolean) {
    if (isSelf) return false;
    return actor === "owner" || (actor === "admin" && (target === "member" || target === "viewer"));
  },
  deleteDompet: (r: Role) => r === "owner",
};

export class PermissionError extends Error {
  constructor(message = "Kamu tidak punya izin untuk ini.") {
    super(message);
  }
}
