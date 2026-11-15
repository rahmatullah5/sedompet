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
function setHidden(v: boolean) {
  hidden = v;
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
