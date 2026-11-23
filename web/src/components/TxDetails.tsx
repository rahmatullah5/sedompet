import { useEffect, useRef, useState } from "react";
import { getMode } from "../cloud/client";
import { cloud } from "../cloud/sync";
import { compressImage } from "../lib/image";
import { attempt, cx, Input } from "./ui";
import { LineIcon } from "./LineIcon";

/** Receipt photo from a stored value: data: URL (demo) or storage path (cloud). */
export function useReceiptUrl(value: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(value?.startsWith("data:") ? value : null);
  useEffect(() => {
    if (!value) return setUrl(null);
    if (value.startsWith("data:")) return setUrl(value);
    let alive = true;
    cloud
      .receiptUrl(value)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [value]);
  return url;
}

export interface PhotoDraft {
  blob: Blob;
  dataUrl: string;
}

/** Turns the form's photo state into the value to store (uploads in cloud mode). */
export async function receiptValue(dompetId: string, existing: string | null, photo: PhotoDraft | null, removed: boolean) {
  if (photo) return getMode() === "cloud" ? cloud.uploadReceipt(dompetId, photo.blob) : photo.dataUrl;
  return removed ? null : existing;
}

/** Kebutuhan / keinginan, tempat beli, and the receipt photo. */
export function TxDetails({
  kind,
  need,
  setNeed,
  merchant,
  setMerchant,
  merchants,
  existingReceipt,
  photo,
  setPhoto,
  removed,
  setRemoved,
}: {
  kind: "expense" | "income";
  need: "need" | "want" | null;
  setNeed: (v: "need" | "want" | null) => void;
  merchant: string;
  setMerchant: (v: string) => void;
  merchants: string[];
  existingReceipt: string | null;
  photo: PhotoDraft | null;
  setPhoto: (p: PhotoDraft | null) => void;
  removed: boolean;
  setRemoved: (v: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const existingUrl = useReceiptUrl(removed ? null : existingReceipt);
  const shown = photo?.dataUrl ?? existingUrl;
  const [open, setOpen] = useState(!!(need || merchant || existingReceipt));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-brand-700">
        + Detail lain (kebutuhan/keinginan, tempat beli, foto nota)
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-3">
      {kind === "expense" && (
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Kebutuhan atau keinginan?</span>
          <div className="flex gap-1.5">
            {(
              [
                ["need", "Kebutuhan"],
                ["want", "Keinginan"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={need === v}
                onClick={() => setNeed(need === v ? null : v)}
                className={cx(
                  "rounded-full border px-3 py-1 text-sm transition",
                  need === v ? "border-brand-600 bg-brand-50 font-semibold ring-1 ring-brand-600" : "border-slate-200 bg-white text-slate-600",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">{kind === "expense" ? "Tempat beli" : "Dari mana"}</span>
        <Input value={merchant} maxLength={60} list="sedompet-merchants" placeholder="mis. Indomaret, Pasar Minggu" onChange={(e) => setMerchant(e.target.value)} />
        <datalist id="sedompet-merchants">
          {merchants.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-500">Foto nota</span>
        {shown ? (
          <div className="flex items-start gap-3">
            <a href={shown} target="_blank" rel="noopener" className="block">
              <img src={shown} alt="Foto nota" className="h-24 w-24 rounded-xl object-cover ring-1 ring-slate-200" />
            </a>
            <div className="flex flex-col gap-1.5">
              <button type="button" className="text-left text-sm font-semibold text-brand-700" onClick={() => fileRef.current?.click()}>
                Ganti foto
              </button>
              <button
                type="button"
                className="text-left text-sm font-semibold text-red-600"
                onClick={() => {
                  setPhoto(null);
                  setRemoved(true);
                }}
              >
                Hapus foto
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white py-3 text-sm font-semibold text-slate-500 hover:border-brand-300 hover:text-brand-700"
          >
            <LineIcon name="camera" size={16} />
            Tambah foto nota
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            await attempt(async () => {
              // Demo keeps photos inside the local database, so smaller there.
              setPhoto(await compressImage(file, getMode() === "cloud" ? 1280 : 900, getMode() === "cloud" ? 0.72 : 0.6));
              setRemoved(false);
            });
          }}
        />
      </div>
    </div>
  );
}
