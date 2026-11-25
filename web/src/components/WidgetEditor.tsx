import type { ReportLayout } from "../lib/reportLayout";
import { LineIcon, type LineIconName } from "./LineIcon";
import { SortableList } from "./SortableList";
import { Card, cx } from "./ui";

export interface EditableWidget {
  id: string;
  title: string;
  hint: string;
  on: boolean;
  icon?: LineIconName;
}

/** "Atur" / "Selesai" pill used by pages with editable widgets. */
export function EditToggle({ editing, onClick }: { editing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold", editing ? "bg-slate-800 text-white" : "bg-white text-slate-700 shadow-sm")}
    >
      <LineIcon name={editing ? "check" : "settings"} size={16} />
      {editing ? "Selesai" : "Atur"}
    </button>
  );
}

/** Reorder (drag), hide, add widgets; resets to the default layout. */
export function WidgetEditor<W extends EditableWidget>({
  widgets,
  saved,
  setSaved,
}: {
  /** All widgets in their current order, with `on` resolved. */
  widgets: W[];
  saved: ReportLayout | null;
  setSaved: (v: ReportLayout | null) => void;
}) {
  const shown = widgets.filter((w) => w.on);
  const off = widgets.filter((w) => !w.on);
  const save = (list: { id: string; on: boolean }[]) => setSaved({ order: list.map((w) => w.id), hidden: list.filter((w) => !w.on).map((w) => w.id) });
  // Reorders the visible widgets; hidden ones keep their slots in between.
  const reorder = (ids: string[]) => {
    const byId = new Map(widgets.map((w) => [w.id, w]));
    let k = 0;
    save(widgets.map((w) => (w.on ? byId.get(ids[k++])! : w)));
  };
  const toggle = (id: string, on: boolean) => {
    const list = widgets.filter((w) => w.id !== id);
    const w = widgets.find((x) => x.id === id)!;
    // An added widget goes to the bottom of the page.
    save(on ? [...list, { ...w, on }] : widgets.map((x) => (x.id === id ? { ...x, on } : x)));
  };

  return (
    <>
      <Card title="Ditampilkan">
        <SortableList
          items={shown}
          onReorder={reorder}
          label={(w) => w.title}
          className="divide-y divide-slate-100"
          render={(w) => (
            <>
              <span className="min-w-0 flex-1 py-2">
                <span className="block truncate text-sm font-semibold text-slate-700">{w.title}</span>
                <span className="block truncate text-xs text-slate-400">{w.hint}</span>
              </span>
              <button
                type="button"
                aria-label={`Sembunyikan ${w.title}`}
                title={`Sembunyikan ${w.title}`}
                onClick={() => toggle(w.id, false)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
              >
                <LineIcon name="eyeOff" size={18} />
              </button>
            </>
          )}
        />
        {shown.length === 0 && <p className="py-3 text-center text-sm text-slate-400">Belum ada widget. Tambahkan dari daftar di bawah.</p>}
      </Card>
      <Card title="Tambah widget">
        {off.length ? (
          <ul className="divide-y divide-slate-100">
            {off.map((w) => (
              <li key={w.id} className="flex items-center gap-2 py-2">
                <LineIcon name={w.icon ?? "chart"} size={18} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-700">{w.title}</span>
                  <span className="block truncate text-xs text-slate-400">{w.hint}</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(w.id, true)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100"
                >
                  <LineIcon name="plus" size={14} />
                  Tambah
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-slate-400">Semua widget sudah ditampilkan.</p>
        )}
      </Card>
      {saved && (
        <button type="button" onClick={() => setSaved(null)} className="w-full rounded-full py-2 text-sm font-semibold text-slate-500 hover:bg-white">
          Kembalikan tampilan awal
        </button>
      )}
    </>
  );
}
