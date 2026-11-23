import { useRef, useState } from "react";
import { cx, toast } from "./ui";
import { LineIcon, type LineIconName } from "./LineIcon";

/** Default account-type emoji drawn as plain line icons instead. */
const LINE_FOR: Record<string, LineIconName> = {
  "💵": "cash",
  "🏦": "bank",
  "📱": "phone",
  "🐷": "piggy",
  "💳": "card",
  "📈": "chart",
  "👛": "wallet",
};

/** Renders an icon value: an emoji, or an uploaded image stored as a data: URL. */
export function Icon({ value, size = 24, className }: { value: string | null | undefined; size?: number; className?: string }) {
  const v = value || "📦";
  if (v.startsWith("data:image/")) {
    return <img src={v} alt="" width={size} height={size} className={cx("inline-block rounded-lg object-cover", className)} style={{ width: size, height: size }} />;
  }
  const line = LINE_FOR[v];
  if (line) return <LineIcon name={line} size={Math.round(size * 0.85)} className={cx("inline-block shrink-0 text-slate-700", className)} />;
  return (
    <span className={cx("inline-block leading-none", className)} style={{ fontSize: size * 0.9 }} aria-hidden>
      {v}
    </span>
  );
}

const GROUPS: { label: string; emojis: string[] }[] = [
  { label: "Makan & rumah", emojis: ["🍜", "🍚", "🍗", "🍞", "☕", "🧋", "🍎", "🥬", "🛒", "🏠", "🏢", "🛋️", "🧹", "🧺", "🔧", "💡", "🚰", "🔥", "📶", "📺"] },
  { label: "Keluarga & sekolah", emojis: ["👶", "🍼", "🎒", "📚", "✏️", "🎓", "🧸", "🐱", "🐶", "💊", "🏥", "🦷", "💇", "🧴", "👕", "👟", "💍", "🎁", "🎂", "🕌"] },
  { label: "Jalan & hiburan", emojis: ["🛵", "🚗", "⛽", "🅿️", "🚌", "🚆", "✈️", "🏖️", "🎬", "🎮", "🎵", "⚽", "🏋️", "📱", "💻", "🎧", "📦", "🛍️", "🤝", "🤲"] },
  { label: "Uang", emojis: ["💰", "💵", "💳", "🏦", "🐷", "📈", "📉", "💼", "🏪", "🧾", "🪙", "💸", "🎯", "🔁", "📅", "⭐", "❤️", "🌱", "🌙", "✨"] },
];

/** Resize an uploaded picture to a small square PNG data: URL (keeps the DB tiny). */
async function fileToIcon(file: File, px = 96): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pilih file gambar (PNG, JPG, WebP).");
  if (file.size > 5 * 1024 * 1024) throw new Error("Gambar terlalu besar (maks 5 MB).");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  // Cover-crop to a centered square.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, px, px);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

export function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [custom, setCustom] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100">
          <Icon value={value} size={28} />
        </span>
        <button type="button" onClick={() => setOpen(true)} className="rounded-full bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          Ganti ikon ▾
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Icon value={value} size={36} />
        </span>
        <div className="flex flex-1 flex-wrap gap-2">
          <input
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              const first = [...e.target.value.trim()].slice(0, 2).join("");
              if (first) onChange(first);
            }}
            placeholder="Ketik emoji…"
            aria-label="Emoji sendiri"
            className="w-28 rounded-2xl bg-slate-100 px-3 py-2 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-100"
          >
            🖼️ Unggah gambar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                onChange(await fileToIcon(f));
              } catch (err) {
                toast(err instanceof Error ? err.message : String(err), "error");
              }
            }}
          />
        </div>
      </div>
      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="mb-1 text-xs font-semibold text-slate-400">{g.label}</p>
            <div className="grid grid-cols-10 gap-1">
              {g.emojis.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => (onChange(e), setOpen(false))}
                  aria-label={e}
                  aria-pressed={value === e}
                  className={cx("flex aspect-square items-center justify-center rounded-xl text-xl transition hover:bg-slate-100", value === e && "bg-brand-100 ring-2 ring-brand-500")}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(false)} className="w-full rounded-xl py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
        Selesai ▴
      </button>
    </div>
  );
}

/** Icon as plain text for <option> labels (images can't render there). */
export function iconText(value: string | null | undefined) {
  return value && !value.startsWith("data:") ? `${value} ` : "";
}
