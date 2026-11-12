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
