// First-use guided tour state. Done = seen (finished or skipped) on this
// device; cloud mode also stores it on the account (sync.ts) so a new phone
// doesn't replay it.

const KEY = "sedompet.tour.done";

type TourState = { done: boolean; running: boolean };

function readDone() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let state: TourState = { done: readDone(), running: false };
const listeners = new Set<() => void>();
let saver: (() => void) | null = null;

function set(next: Partial<TourState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const tourStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Cloud: how to remember "done" on the account. */
export function setTourSaver(fn: (() => void) | null) {
  saver = fn;
}
/** The account says the tour was already seen (no save back). */
export function applyTourDoneFromAccount() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
  if (!state.done) set({ done: true });
}

export function startTour() {
  set({ running: true });
}

export function finishTour() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore */
  }
  if (!state.done) saver?.();
  set({ done: true, running: false });
}
