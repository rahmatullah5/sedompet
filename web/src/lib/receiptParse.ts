// Turns OCR text of a struk / payment screenshot into a transaction draft.
// Pure functions (no DOM), so they are easy to test.

export interface ReceiptDraft {
  amount: number | null;
  date: string | null;
  merchant: string | null;
  kind: "expense" | "income";
  /** Lower-case words to match against category names. */
  categoryHints: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, ags: 8, aug: 8, agt: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

/** Known shops/apps -> display name + category words. */
const BRANDS: [RegExp, string, string[]][] = [
  [/indomaret/i, "Indomaret", ["belanja", "dapur", "groceries", "kebutuhan"]],
  [/alfamart/i, "Alfamart", ["belanja", "dapur", "groceries", "kebutuhan"]],
  [/alfamidi/i, "Alfamidi", ["belanja", "dapur", "groceries"]],
  [/super\s*indo/i, "Superindo", ["belanja", "dapur", "groceries"]],
  [/hypermart/i, "Hypermart", ["belanja", "dapur", "groceries"]],
  [/transmart|carrefour/i, "Transmart", ["belanja", "dapur", "groceries"]],
  [/lotte\s*mart/i, "Lotte Mart", ["belanja", "dapur", "groceries"]],
  [/ranch\s*market|farmers\s*market|grand\s*lucky|total\s*buah/i, "Supermarket", ["belanja", "dapur", "groceries"]],
  [/guardian/i, "Guardian", ["kesehatan", "health", "self care", "belanja"]],
  [/watsons/i, "Watsons", ["kesehatan", "health", "self care", "belanja"]],
  [/kimia\s*farma|apotek|k-?24|century/i, "Apotek", ["kesehatan", "health", "obat"]],
  [/starbucks/i, "Starbucks", ["makan", "minum", "kopi", "food"]],
  [/kopi\s*kenangan|janji\s*jiwa|fore\s*coffee|tomoro|point\s*coffee/i, "Kopi", ["makan", "minum", "kopi", "food"]],
  [/mcdonald|mcd\b/i, "McDonald's", ["makan", "minum", "food"]],
  [/\bkfc\b/i, "KFC", ["makan", "minum", "food"]],
  [/solaria|hokben|hoka\s*hoka|pizza\s*hut|richeese|chatime|mixue|burger\s*king|sushi/i, "Restoran", ["makan", "minum", "food"]],
  [/gofood|grabfood|shopeefood/i, "Pesan antar", ["makan", "minum", "food"]],
  [/pertamina|spbu/i, "Pertamina", ["bensin", "transport", "bbm", "kendaraan"]],
  [/\bshell\b/i, "Shell", ["bensin", "transport", "bbm", "kendaraan"]],
  [/gojek|goride|gocar/i, "Gojek", ["transport", "gojek"]],
  [/\bgrab\b|grabcar|grabbike/i, "Grab", ["transport", "grab"]],
  [/\bkai\b|kereta|krl|commuter/i, "KAI", ["transport", "kai"]],
  [/\bpln\b|token\s*listrik|listrik/i, "PLN", ["listrik", "air", "tagihan", "utilit"]],
  [/pdam|air\s*minum/i, "PDAM", ["listrik", "air", "tagihan"]],
  [/telkomsel|indosat|\bxl\b|axis|smartfren|\btri\b|by\.u/i, "Pulsa", ["pulsa", "internet", "paket"]],
  [/indihome|biznet|first\s*media|myrepublic|iconnet/i, "Internet", ["internet", "wifi", "pulsa"]],
  [/tokopedia/i, "Tokopedia", ["belanja", "online"]],
  [/shopee/i, "Shopee", ["belanja", "online"]],
  [/lazada/i, "Lazada", ["belanja", "online"]],
  [/ace\s*hardware|informa|ikea|mitra10|depo\s*bangunan/i, "Toko rumah", ["rumah", "perabot", "belanja"]],
  [/bpjs/i, "BPJS", ["kesehatan", "asuransi", "health"]],
  [/netflix|spotify|youtube|disney|vidio/i, "Langganan", ["hiburan", "langganan", "entertainment"]],
];

const GENERIC = new Set(["Supermarket", "Apotek", "Kopi", "Restoran", "Pesan antar", "Pulsa", "Internet", "Toko rumah", "Langganan"]);

/** Lines that are never the purchase total. */
const NOT_TOTAL = /sub\s*-?total|tunai|cash|kembali|kembalian|change|ppn|pajak|\btax\b|diskon|\bdisc|hemat|potongan|saldo|poin|point|voucher|qty|harga\s*satuan|npwp|telp|no\.?\s*(ref|trx|transaksi)|kode|id\s*transaksi|reference/i;
const TOTAL = /grand\s*total|total\s*(bayar|belanja|pembayaran|tagihan|harga|transaksi|transfer)?|jumlah\s*(bayar|tagihan|pembayaran|transfer)?|nominal|\bamount\b|harus\s*dibayar|total\s*payment|dibayar|pembayaran\s*berhasil|berhasil\s*dibayar|tagihan/i;

/** Indonesian / international money token -> integer rupiah (decimals dropped). */
export function parseAmountToken(raw: string): number | null {
  let t = raw.replace(/rp\.?|idr/gi, "").replace(/\s+/g, "").replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, "0");
  // Drop trailing cents: 125.000,00 / 125,000.00 / 12.500,5
  t = t.replace(/^(\d{1,3}(?:[.,]\d{3})+)[.,]\d{1,2}$/, "$1").replace(/^(\d+)[.,]\d{1,2}$/, (m, a: string) => (a.length >= 3 ? a : m.replace(/[.,]/, "")));
  const digits = t.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_RE = /(?:rp\.?\s*|idr\s*)?\d{1,3}(?:[.,]\s?\d{3})+(?:[.,]\d{1,2})?|(?:rp\.?\s*|idr\s*)\d{3,}(?:[.,]\d{1,2})?|\b\d{4,9}\b/gi;

function amountsIn(line: string) {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    // Skip things that look like dates, times, phone or card numbers.
    if (/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(m[0])) continue;
    const n = parseAmountToken(m[0]);
    if (n !== null && n >= 500 && n <= 500_000_000) out.push(n);
  }
  return out;
}

function validDate(y: number, mo: number, d: number, today: Date) {
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null;
  const diff = (dt.getTime() - today.getTime()) / 86_400_000;
  if (diff > 1 || diff < -400) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function findDate(text: string, today = new Date()): string | null {
  const t = text.replace(/[|]/g, "/");
  const pats: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/g, (m) => validDate(+m[1], +m[2], +m[3], today)],
    [/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/g, (m) => validDate(+m[3], +m[2], +m[1], today)],
    [/(\d{1,2})\s*[-.]?\s*([a-z]{3})[a-z]*\.?\s*[-.]?\s*(\d{2,4})/gi, (m) => (MONTHS[m[2].toLowerCase()] ? validDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1], today) : null)],
  ];
  for (const [re, fn] of pats) for (const m of t.matchAll(re)) {
    const d = fn(m);
    if (d) return d;
  }
  return null;
}

export function findTotal(lines: string[]): number | null {
  let best: { score: number; amount: number } | null = null;
  lines.forEach((line, i) => {
    if (!TOTAL.test(line) || NOT_TOTAL.test(line)) return;
    // The value may sit on the same line or (in app screenshots) the next one.
    const amounts = amountsIn(line).length ? amountsIn(line) : amountsIn(lines[i + 1] ?? "");
    if (!amounts.length) return;
    const amount = amounts[amounts.length - 1];
    let score = 10;
    if (/grand\s*total|total\s*bayar|harus\s*dibayar|total\s*pembayaran/i.test(line)) score += 5;
    if (/rp/i.test(line) || /rp/i.test(lines[i + 1] ?? "")) score += 1;
    if (!best || score > best.score || (score === best.score && amount > best.amount)) best = { score, amount };
  });
  if (best) return (best as { amount: number }).amount;
  // Fallback: the largest amount on a line that isn't cash paid / change / tax.
  const all = lines.filter((l) => !NOT_TOTAL.test(l)).flatMap(amountsIn);
  return all.length ? Math.max(...all) : null;
}

const NOT_MERCHANT = /struk|receipt|invoice|nota|kasir|cashier|npwp|telp|phone|jl\.?\s|jalan|tanggal|date|waktu|time|no\.|transaksi|berhasil|sukses|success|pembayaran|payment|detail|total|rp\b|www\.|\.com|terima kasih|thank/i;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function findMerchant(lines: string[], text: string): { name: string | null; hints: string[] } {
  for (const [re, name, hints] of BRANDS) {
    const m = text.match(re);
    if (m) return { name: GENERIC.has(name) ? titleCase(m[0]) : name, hints };
  }
  const from = text.match(/(?:menerima\s+.*?\s+dari|diterima\s+dari|terima\s+dari|transfer\s+dari|from)\s+([\p{L} .'-]{3,40})/iu);
  if (from) return { name: titleCase(from[1]).slice(0, 40), hints: [] };
  for (const line of lines) {
    const m = line.match(/(?:bayar|pembayaran|transfer|kirim|dikirim)\s+(?:ke|kepada)\s*:?\s*(.+)/i) ?? line.match(/(?:merchant|nama\s*merchant|penerima|nama\s*penerima|tujuan|toko|outlet)\s*:?\s+(.+)/i);
    if (m) {
      const name = m[1].replace(AMOUNT_RE, "").replace(/[^\p{L}\p{N}&'.\- ]/gu, "").trim();
      if (name.length >= 3) return { name: titleCase(name).slice(0, 40), hints: [] };
    }
  }
  // First header line that reads like a name.
  for (const line of lines.slice(0, 6)) {
    const clean = line.replace(/[^\p{L}\p{N}&'.\- ]/gu, " ").replace(/\s+/g, " ").trim();
    const letters = (clean.match(/\p{L}/gu) ?? []).length;
    if (letters >= 4 && letters / Math.max(1, clean.length) > 0.6 && !NOT_MERCHANT.test(clean)) return { name: titleCase(clean).slice(0, 40), hints: [] };
  }
  return { name: null, hints: [] };
}

export function parseReceipt(text: string, today = new Date()): ReceiptDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1);
  const { name, hints } = findMerchant(lines, text);
  const income = /dana\s*masuk|uang\s*masuk|transfer\s*masuk|diterima\s*dari|terima\s*dari|kamu\s*menerima|you\s*received|refund\s*berhasil/i.test(text);
  return {
    amount: findTotal(lines),
    date: findDate(text, today),
    merchant: name,
    kind: income ? "income" : "expense",
    categoryHints: hints,
  };
}
