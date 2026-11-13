import { useEffect } from "react";
import { trash, TRASH_DAYS } from "../db/trash";
import { can } from "../lib/permissions";
import { useCurrent, useDbVersion } from "../lib/hooks";
import { timeAgo } from "../lib/format";
import { attempt, Button, Card, Empty } from "../components/ui";

/** "Sampah": things deleted on this device in the last 30 days, restorable. */
export function Trash() {
  useDbVersion();
  const { dompet, me } = useCurrent();
  const items = trash.list(dompet.id);
  const manage = can.manage(me.role);

  // Drop entries past the retention window (a write, so not during render).
  useEffect(() => {
    trash.purge(dompet.id).catch(() => {}); // e.g. read-only Dompet
  }, [dompet.id]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800">Sampah</h1>
        <p className="text-sm text-slate-500">
          Yang dihapus dari perangkat ini bisa dipulihkan selama {TRASH_DAYS} hari.
        </p>
      </div>
      <Card>
        {items.length === 0 ? (
          <Empty icon="🗑️" title="Sampah kosong">
            Transaksi, transfer, anggaran, tujuan, tagihan rutin dan pinjaman yang dihapus muncul di sini.
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((it) => {
              const allowed = it.deleted_by === me.id || manage;
              return (
                <li key={it.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-800">{it.label}</p>
                    <p className="text-xs text-slate-500">
                      {it.deleted_by_name ?? "Seseorang"} · {timeAgo(it.deleted_at)}
                      {it.count > 1 ? ` · ${it.count} catatan` : ""}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!allowed}
                    onClick={() =>
                      attempt(() => trash.restore(it.id, { id: me.id, dompet_id: dompet.id, canManage: manage }), "Dipulihkan ↩️")
                    }
                  >
                    Pulihkan
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2"
                    disabled={!allowed}
                    aria-label={`Hapus permanen ${it.label}`}
                    onClick={() => confirm(`Hapus permanen "${it.label}"? Tidak bisa dipulihkan lagi.`) && attempt(() => trash.purge(dompet.id, it.id))}
                  >
                    ✕
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-center text-xs text-slate-400">Sampah disimpan di perangkat ini saja, tidak ikut tersinkron ke anggota lain.</p>
    </div>
  );
}
