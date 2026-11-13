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

/** Promo subscription purchase: admin replies with payment details and an activation code. */
export const WA_SUBSCRIBE = (plan: "bulanan" | "tahunan") =>
  waLink(
    `Halo, saya mau langganan Sedompet ${plan === "tahunan" ? "Tahunan Rp99.000/12 bulan" : "Bulanan Rp10.000/bulan"} (harga promo). Nomor HP yang mau diaktifkan: `,
  );
