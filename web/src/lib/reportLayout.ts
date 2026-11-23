// Which widgets the Laporan page shows, and in what order.
//
// Saved on this device (localStorage) and, when signed in, on the account
// (auth user_metadata.reports_widgets, see sync.ts) so it follows the user.
// Only the user's own choices are stored: widgets added to the app later
// appear with their default visibility.

import { useSyncExternalStore } from "react";

export interface ReportLayout {
  /** Widget ids in display order (every widget the user has seen). */
  order: string[];
  /** Ids the user turned off. */
  hidden: string[];
}

const KEY = "sedompet.reports.layout";
const listeners = new Set<() => void>();

function valid(v: unknown): v is ReportLayout {
  const o = v as ReportLayout;
  return !!o && Array.isArray(o.order) && Array.isArray(o.hidden) && [...o.order, ...o.hidden].every((x) => typeof x === "string");
}

let layout: ReportLayout | null = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return valid(v) ? v : null;
  } catch {
    return null;
  }
})();

let saver: ((v: ReportLayout | null) => void) | null = null;
/** Cloud mode saves the layout to the account too. */
export function setReportLayoutSaver(fn: ((v: ReportLayout | null) => void) | null) {
  saver = fn;
}

function set(v: ReportLayout | null, save = true) {
  layout = v;
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: kept for this session */
  }
  if (save) saver?.(v);
  listeners.forEach((l) => l());
}

/** Applies the layout stored on the account (no save back). */
export function applyReportLayoutFromAccount(v: unknown) {
  if (v === null) return set(null, false);
  if (valid(v) && JSON.stringify(v) !== JSON.stringify(layout)) set(v, false);
}

export function useReportLayout(): [ReportLayout | null, (v: ReportLayout | null) => void] {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => layout,
  );
  return [v, set];
}

/**
 * The widgets to draw: the saved order first, then any widget the saved
 * layout doesn't know yet at its default place and visibility.
 */
export function resolveLayout<W extends { id: string; defaultOn: boolean }>(widgets: W[], saved: ReportLayout | null) {
  if (!saved) return widgets.map((w) => ({ ...w, on: w.defaultOn }));
  const byId = new Map(widgets.map((w) => [w.id, w]));
  const order = saved.order.filter((id) => byId.has(id));
  widgets.forEach((w, i) => {
    if (order.includes(w.id)) return;
    // after the widget that comes before it by default
    const prev = widgets.slice(0, i).reverse().find((p) => order.includes(p.id));
    order.splice(prev ? order.indexOf(prev.id) + 1 : 0, 0, w.id);
  });
  const known = new Set(saved.order);
  return order.map((id) => {
    const w = byId.get(id)!;
    return { ...w, on: known.has(id) ? !saved.hidden.includes(id) : w.defaultOn };
  });
}
