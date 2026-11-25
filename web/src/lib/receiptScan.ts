// On-device receipt OCR (tesseract.js, loaded only when someone scans).
// The language data (~10 MB, Indonesian + English) is downloaded once by the
// browser and cached.

import { compressImage } from "./image";
import { parseReceipt, type ReceiptDraft } from "./receiptParse";

export interface ScanResult {
  draft: ReceiptDraft;
  text: string;
  /** Smaller copy to attach as the transaction's receipt photo. */
  photo: { blob: Blob; dataUrl: string };
}

/** Grey + stretched contrast helps OCR on faded thermal paper. */
async function prepare(file: File) {
  const { blob } = await compressImage(file, 2000, 0.92);
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) * 255) / range;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function scanReceipt(file: File, onProgress: (p: number, label: string) => void): Promise<ScanResult> {
  if (!file.type.startsWith("image/")) throw new Error("Pilih foto struk atau screenshot bukti bayar (JPG/PNG).");
  onProgress(0.03, "Menyiapkan foto…");
  const [canvas, photo, { createWorker }] = await Promise.all([prepare(file), compressImage(file), import("tesseract.js")]);
  onProgress(0.08, "Memuat pembaca teks…");
  const worker = await createWorker(["ind", "eng"], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress(0.35 + m.progress * 0.62, "Membaca struk…");
      else if (/load|initializ/i.test(m.status)) onProgress(0.08 + m.progress * 0.25, "Memuat pembaca teks…");
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    onProgress(1, "Selesai");
    return { draft: parseReceipt(data.text), text: data.text, photo };
  } finally {
    void worker.terminate();
  }
}
