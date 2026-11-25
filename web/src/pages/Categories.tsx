import { useState } from "react";
import { m, q, type Category, type Kind } from "../db/repo";
import { can } from "../lib/permissions";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { askConfirm, attempt, Button, Card, cx, Field, Input, Modal, Select, STICKY_ACTIONS } from "../components/ui";
import { Icon, IconPicker } from "../components/Icon";

const COLOURS = ["#f47c5a", "#f5a524", "#2fb67c", "#22a6b3", "#4f8ef7", "#8b74e8", "#e5689b", "#8a7563"];

type Editing = { category: Category | null; parentId: string | null; kind: Kind } | null;

export function Categories() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const manage = can.manage(me.role);
  const [kind, setKind] = useState<Kind>("expense");
  const [editing, setEditing] = useState<Editing>(null);
  const all = q.categories(dompet.id, kind);
  const parents = all.filter((c) => !c.parent_id);
  const subsOf = (id: string) => all.filter((c) => c.parent_id === id);

  return (
    <div className="space-y-4">
      <div>
        <a href="#/menu" className="text-sm font-semibold text-brand-700">
          ← Menu
        </a>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-800">Kategori</h1>
        <p className="text-sm text-slate-500">Kelompokkan belanja keluarga. Tiap kategori bisa punya subkategori, mis. Makan → Sarapan, Jajan anak.</p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 shadow-sm">
        {(["expense", "income"] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cx("rounded-full py-2 text-sm font-bold transition", kind === k ? "bg-slate-800 text-white" : "text-slate-500")}
          >
            {k === "expense" ? "Pengeluaran" : "Pemasukan"}
          </button>
        ))}
      </div>

      {manage && (
        <Button className="w-full" variant="secondary" onClick={() => setEditing({ category: null, parentId: null, kind })}>
          + Kategori baru
        </Button>
      )}

      <div className="space-y-3">
        {parents.map((p) => (
          <Card key={p.id} className="p-3">
            <button
              disabled={!manage}
              onClick={() => setEditing({ category: p, parentId: null, kind })}
              className="flex w-full items-center gap-3 rounded-2xl p-1 text-left enabled:hover:bg-slate-50"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: `${p.colour}26` }}>
                <Icon value={p.icon} size={26} />
              </span>
              <span className="flex-1 font-bold text-slate-800">{p.name}</span>
              <span className="text-xs text-slate-400">{subsOf(p.id).length ? `${subsOf(p.id).length} sub` : ""}</span>
            </button>
            {(subsOf(p.id).length > 0 || manage) && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-14">
                {subsOf(p.id).map((s) => (
                  <button
                    key={s.id}
                    disabled={!manage}
                    onClick={() => setEditing({ category: s, parentId: p.id, kind })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-2 pr-3 text-sm font-medium text-slate-700 enabled:hover:bg-slate-200"
                  >
                    <Icon value={s.icon} size={18} /> {s.name}
                  </button>
                ))}
                {manage && (
                  <button
                    onClick={() => setEditing({ category: null, parentId: p.id, kind })}
                    className="rounded-full border-2 border-dashed border-slate-200 px-3 py-0.5 text-sm font-semibold text-slate-500 hover:border-brand-500 hover:text-brand-700"
                  >
                    + sub
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      {!manage && <p className="text-center text-xs text-slate-400">Hanya pemilik/admin yang bisa mengubah kategori.</p>}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.category ? "Ubah kategori" : editing?.parentId ? "Subkategori baru" : "Kategori baru"}>
        {editing && <CategoryForm key={editing.category?.id ?? `new-${editing.parentId}`} editing={editing} parents={parents} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function CategoryForm({ editing, parents, onClose }: { editing: NonNullable<Editing>; parents: Category[]; onClose: () => void }) {
  const { me } = useCurrent();
  const c = editing.category;
  const [name, setName] = useState(c?.name ?? "");
  const [icon, setIcon] = useState(c?.icon ?? "🏷️");
  const [colour, setColour] = useState(c?.colour ?? COLOURS[0]);
  const [parentId, setParentId] = useState<string>(editing.parentId ?? c?.parent_id ?? "");
  const hasSubs = c ? parents.some((p) => p.id === c.id) && q.categories(c.dompet_id).some((x) => x.parent_id === c.id) : false;

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await attempt(
          () => m.saveCategory(me.id, { id: c?.id, name, icon, colour, kind: editing.kind, parent_id: parentId || null }),
          "Kategori disimpan",
        );
        if (ok) onClose();
      }}
    >
      <Field label="Nama">
        <Input autoFocus value={name} maxLength={40} placeholder="mis. Jajan Anak" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">Ikon</span>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      {!hasSubs && (
        <Field label="Masuk ke kategori" hint="Kosongkan untuk kategori utama.">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— Kategori utama —</option>
            {parents
              .filter((p) => p.id !== c?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon.startsWith("data:") ? "" : `${p.icon} `}
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      {!parentId && (
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-slate-700">Warna</span>
          <div className="flex flex-wrap gap-2">
            {COLOURS.map((col) => (
              <button
                key={col}
                type="button"
                aria-label={`Warna ${col}`}
                onClick={() => setColour(col)}
                className="h-8 w-8 rounded-full"
                style={{ background: col, boxShadow: colour === col ? `0 0 0 2px white, 0 0 0 4px ${col}` : undefined }}
              />
            ))}
          </div>
        </div>
      )}
      {c && <MergeSection category={c} onDone={onClose} />}
      <div className={`${STICKY_ACTIONS} justify-between`}>
        <div>
          {c && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!await askConfirm(`Hapus ${c.name}?${hasSubs ? " Subkategorinya ikut terhapus." : ""} Transaksinya jadi "Tanpa kategori".`)) return;
                if (await attempt(() => m.deleteCategory(me.id, c.id), "Kategori dihapus")) onClose();
              }}
            >
              Hapus
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Simpan
          </Button>
        </div>
      </div>
    </form>
  );
}

/** "Gabungkan ke kategori lain": move everything into another category, then remove this one. */
function MergeSection({ category: c, onDone }: { category: Category; onDone: () => void }) {
  const { me } = useCurrent();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const all = q.categories(c.dompet_id, c.kind);
  const subs = all.filter((x) => x.parent_id === c.id);
  const parentName = (x: Category) => (x.parent_id ? all.find((p) => p.id === x.parent_id)?.name : null);
  // Not itself, and not one of its own subcategories.
  const targets = all.filter((x) => x.id !== c.id && x.parent_id !== c.id);
  const target = targets.find((x) => x.id === targetId);
  const used = q.usage(c.dompet_id);
  const txCount = [c, ...subs].reduce((t, x) => t + (used.get(x.id) ?? 0), 0);
  const label = (x: Category) => `${parentName(x) ? `${parentName(x)} → ` : ""}${x.name}`;

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand-700">
        Gabungkan ke kategori lain
      </button>
    );
  return (
    <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
      <Field
        label={`Gabungkan ${c.name} ke`}
        hint={`${txCount} transaksi${subs.length ? ` (termasuk ${subs.length} subkategori)` : ""}, tagihan rutin dan anggarannya ikut pindah. ${c.name} lalu dihapus.`}
      >
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— Pilih kategori tujuan —</option>
          {targets.map((x) => (
            <option key={x.id} value={x.id}>
              {label(x)}
            </option>
          ))}
        </Select>
      </Field>
      {target && subs.length > 0 && (
        <p className="text-xs text-slate-500">
          {target.parent_id
            ? `Subkategori ${subs.map((x) => x.name).join(", ")} ikut digabung ke ${target.name}.`
            : `Subkategori ${subs.map((x) => x.name).join(", ")} pindah ke bawah ${target.name}.`}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => (setOpen(false), setTargetId(""))}>
          Batal
        </Button>
        <Button
          disabled={!target}
          onClick={async () => {
            if (!target) return;
            if (!await askConfirm(`Gabungkan ${c.name} ke ${target.name}? ${txCount} transaksi pindah ke ${target.name}. Tidak bisa dibatalkan.`)) return;
            if (await attempt(() => m.mergeCategory(me.id, c.id, target.id), `${c.name} digabung ke ${target.name}`)) onDone();
          }}
        >
          Gabungkan
        </Button>
      </div>
    </div>
  );
}
