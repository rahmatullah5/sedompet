// Contact the Sedompet admin on WhatsApp (activation requests, feedback).

/** Admin's WhatsApp number in international format (wa.me needs no "+" or leading 0). */
export const ADMIN_WA = "6289501289411";

/** https://wa.me link, optionally with a pre-filled message. */
export function waLink(text?: string) {
  return `https://wa.me/${ADMIN_WA}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export const WA_ACTIVATE = (phone?: string) =>
  waLink(`Halo, saya mau minta aktivasi nomor Sedompet${phone ? ` ${phone}` : ""}. Terima kasih!`);

export const WA_FEEDBACK = waLink("Halo, saya punya masukan/saran untuk Sedompet: ");
