// Which Dompet is open and which member you are "acting as".
//
// Kept per browser tab (sessionStorage) so two tabs can act as two different
// family members at once. localStorage remembers the last choice for new tabs.

export interface Session {
  dompetId: string | null;
  memberId: string | null;
}

const KEY = "sedompet.session";
const listeners = new Set<() => void>();

function read(): Session {
  for (const storage of [sessionStorage, localStorage]) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) return JSON.parse(raw) as Session;
    } catch {
      /* storage blocked or corrupt: fall through */
    }
  }
  return { dompetId: null, memberId: null };
}

let current: Session = read();

// Has someone picked "who's using" in *this* tab yet? New tabs ask again,
// which is what makes the two-tab family demo feel natural.
const PICKED_KEY = "sedompet.picked";
let pickedInTab = (() => {
  try {
    return sessionStorage.getItem(PICKED_KEY) === "1";
  } catch {
    return true;
  }
})();

export function hasPickedInTab() {
  return pickedInTab;
}

export function getSession(): Session {
  return current;
}

/** `picked: true` marks that a person chose who they are in this tab. */
export function setSession(next: Partial<Session>, opts: { picked?: boolean } = {}) {
  current = { ...current, ...next };
  if (opts.picked) {
    pickedInTab = true;
    try {
      sessionStorage.setItem(PICKED_KEY, "1");
    } catch {
      /* ignore */
    }
  }
  const raw = JSON.stringify(current);
  try {
    sessionStorage.setItem(KEY, raw);
    localStorage.setItem(KEY, raw);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
