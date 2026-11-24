// A vertical list the user reorders by dragging a grip handle (mouse or
// touch, via pointer events). Arrow keys on the focused handle move an item
// one place, so it still works without a pointer.

import { useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

interface Drag {
  id: string;
  from: number;
  to: number;
  dy: number;
  startY: number;
  /** Height of the dragged row (shift for the rows it passes). */
  size: number;
  /** Row centres when the drag started. */
  centres: number[];
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  label,
  render,
  className,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  label: (item: T) => string;
  render: (item: T) => ReactNode;
  className?: string;
}) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [drag, setDrag] = useState<Drag | null>(null);

  const commit = (from: number, to: number) => {
    if (from === to) return;
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  };

  const start = (e: React.PointerEvent<HTMLButtonElement>, id: string, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rects = items.map((i) => rows.current.get(i.id)!.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    setDrag({ id, from, to: from, dy: 0, startY: e.clientY, size: rects[from].height + gap, centres: rects.map((r) => r.top + r.height / 2) });
    navigator.vibrate?.(8);
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    const centre = drag.centres[drag.from] + dy;
    let to = drag.from;
    while (to < items.length - 1 && centre > drag.centres[to + 1]) to++;
    while (to > 0 && centre < drag.centres[to - 1]) to--;
    if (to !== drag.to) navigator.vibrate?.(4);
    setDrag({ ...drag, dy, to });
  };

  const end = () => {
    if (!drag) return;
    commit(drag.from, drag.to);
    setDrag(null);
  };

  const shift = (i: number) => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.size;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.size;
    return 0;
  };

  return (
    <ul className={className}>
      {items.map((item, i) => {
        const dragging = drag?.id === item.id;
        return (
          <li
            key={item.id}
            ref={(el) => {
              if (el) rows.current.set(item.id, el);
              else rows.current.delete(item.id);
            }}
            style={{ transform: `translateY(${dragging ? drag.dy : shift(i)}px)` }}
            className={cx(
              "relative flex items-center gap-2 bg-white",
              dragging ? "z-10 scale-[1.02] rounded-xl shadow-lg ring-1 ring-slate-200" : drag && "transition-transform duration-200 ease-out",
            )}
          >
            <button
              type="button"
              aria-label={`Geser ${label(item)} (panah atas/bawah)`}
              title="Tahan lalu geser"
              onPointerDown={(e) => start(e, item.id, i)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
                if (to < 0 || to >= items.length) return;
                e.preventDefault();
                commit(i, to);
              }}
              className={cx("touch-none select-none rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600", dragging ? "cursor-grabbing" : "cursor-grab")}
            >
              <LineGrip />
            </button>
            {render(item)}
          </li>
        );
      })}
    </ul>
  );
}

/** Six dots: "hold to move". */
function LineGrip() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <circle cx={9} cy={y} r={1.6} />
          <circle cx={15} cy={y} r={1.6} />
        </g>
      ))}
    </svg>
  );
}
