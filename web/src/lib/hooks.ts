import { createContext, useContext, useSyncExternalStore } from "react";
import { getVersion, subscribe } from "../db/database";
import { getSession, subscribeSession } from "./session";
import type { Dompet, Member } from "../db/repo";

/** Re-render whenever the database changes (this tab or another tab). */
export function useDbVersion() {
  return useSyncExternalStore(subscribe, getVersion);
}

export function useSession() {
  return useSyncExternalStore(subscribeSession, getSession);
}

export interface Current {
  dompet: Dompet;
  me: Member;
  members: Member[];
}

export const CurrentContext = createContext<Current | null>(null);

export function useCurrent(): Current {
  const c = useContext(CurrentContext);
  if (!c) throw new Error("useCurrent outside CurrentContext");
  return c;
}

// "Sembunyikan saldo": remembered per device so the app stays hidden on the
// next open (useful when opening it in public).
const HIDE_KEY = "sedompet.hideBalance";
const hideListeners = new Set<() => void>();
function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}
let hidden = readHidden();
/** Cloud mode saves the choice to the account too (see sync.ts), so it follows the user. */
let onHiddenChange: ((v: boolean) => void) | null = null;
export function setHiddenSaver(fn: ((v: boolean) => void) | null) {
  onHiddenChange = fn;
}
/** Applies the choice stored on the account (no save back). */
export function applyHiddenFromAccount(v: boolean) {
  if (v !== hidden) setHidden(v, false);
}
function setHidden(v: boolean, save = true) {
  hidden = v;
  if (save) onHiddenChange?.(v);
  try {
    localStorage.setItem(HIDE_KEY, v ? "1" : "0");
  } catch {
    /* private mode: still hides for this session */
  }
  hideListeners.forEach((l) => l());
}

/** [hidden, toggle] for the hide-balance switch; shared across components. */
export function useHideBalance(): [boolean, () => void] {
  const h = useSyncExternalStore(
    (l) => (hideListeners.add(l), () => hideListeners.delete(l)),
    () => hidden,
  );
  return [h, () => setHidden(!hidden)];
}

/** Mask for an amount while the balance is hidden. */
export const MASK = "Rp ••••••";

// "Akun utama": the account new entries start on, per member, remembered on
// this device.
const MAIN_KEY = (memberId: string) => `sedompet.mainAccount.${memberId}`;
const mainListeners = new Set<() => void>();
let mainVersion = 0;
export function getMainAccount(memberId: string): string | null {
  try {
    return localStorage.getItem(MAIN_KEY(memberId));
  } catch {
    return null;
  }
}
export function setMainAccount(memberId: string, accountId: string | null) {
  try {
    if (accountId) localStorage.setItem(MAIN_KEY(memberId), accountId);
    else localStorage.removeItem(MAIN_KEY(memberId));
  } catch {
    /* private mode */
  }
  mainVersion++;
  mainListeners.forEach((l) => l());
}
/** The member's main account id (re-renders when it changes). */
export function useMainAccount(memberId: string): string | null {
  useSyncExternalStore(
    (l) => (mainListeners.add(l), () => mainListeners.delete(l)),
    () => mainVersion,
  );
  return getMainAccount(memberId);
}
