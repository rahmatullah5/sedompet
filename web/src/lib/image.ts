/** Shrinks a photo to a JPEG (max side `maxSide` px) for receipts. */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<{ blob: Blob; dataUrl: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Pilih file foto.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Foto tidak bisa dibuka. Coba foto lain (JPG/PNG).");
  });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser ini tidak bisa memproses foto.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Gagal memproses foto."))), "image/jpeg", quality),
  );
  const dataUrl = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
  return { blob, dataUrl };
}
