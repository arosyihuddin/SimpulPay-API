// QRIS EMVCo generation
import { getSetting, setSetting } from '../db/queries';
const QRIS_EXPIRY_MS = 5 * 60 * 1000; // 5 menit

// QRIS static & merchant ID: sumber DB (di-set via UI Settings)
export async function getQrisStatic(): Promise<string> {
  return (await getSetting('qris_static')) || '';
}
export async function setQrisStatic(code: string): Promise<void> {
  await setSetting('qris_static', code);
}
export async function getMerchantId(): Promise<string> {
  return (await getSetting('gopay_merchant_id')) || '';
}
export async function setMerchantId(id: string): Promise<void> {
  await setSetting('gopay_merchant_id', id);
}

// Parse EMVCo TLV jadi map tag → value
export function parseQrisTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (isNaN(len)) break;
    const val = payload.slice(i + 4, i + 4 + len);
    out[tag] = val;
    i += 4 + len;
  }
  return out;
}

// Hitung Checksum CRC16 EMVCo untuk QRIS
export function calculateCRC16(payload: string) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Generate QRIS Dinamis Standar EMVCo (Parsing TLV Presisi Tinggi)
export function generateDynamicQRIS(staticTemplate: string, amount: unknown) {
  if (!staticTemplate) return null;
  let payload = staticTemplate.trim();

  // Hapus Tag 63 (CRC) lama jika ada di akhir
  const idx63 = payload.indexOf('6304');
  if (idx63 !== -1) {
    payload = payload.substring(0, idx63);
  }

  // Parse EMVCo TLV Tags
  const tags: { tag: string; val: string }[] = [];
  let i = 0;
  try {
    while (i < payload.length) {
      const tag = payload.substring(i, i + 2);
      const length = parseInt(payload.substring(i + 2, i + 4), 10);
      if (isNaN(length)) break;
      const val = payload.substring(i + 4, i + 4 + length);
      tags.push({ tag, val });
      i += 4 + length;
    }
  } catch {
    return null;
  }

  const amountStr = parseInt(amount as string, 10).toString();
  const newTags: { tag: string; val: string }[] = [];
  let hasTag54 = false;

  for (const item of tags) {
    if (item.tag === '01') {
      // Ubah Static (11) ke Dynamic (12)
      newTags.push({ tag: '01', val: '12' });
    } else if (item.tag === '54') {
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
    } else if (item.tag === '58' && !hasTag54) {
      newTags.push({ tag: '54', val: amountStr });
      hasTag54 = true;
      newTags.push(item);
    } else {
      newTags.push(item);
    }
  }

  if (!hasTag54) {
    newTags.push({ tag: '54', val: amountStr });
  }

  let result = '';
  for (const item of newTags) {
    const lenStr = item.val.length.toString().padStart(2, '0');
    result += `${item.tag}${lenStr}${item.val}`;
  }

  result += '6304';
  const checksum = calculateCRC16(result);
  return result + checksum;
}

export function qrisExpiryMs() {
  return QRIS_EXPIRY_MS;
}

// Nominal unik per QRIS: base + kode acak → dua user bayar nominal sama tetep beda QRIS.
// Customer bayar `pay`, bukan `base`. Kode skala ikut nominal (~1%), range 9..100.
// ponytail: base <100 cuma 9 variasi → tabrakan mungkin; migrasi GoBiz create-transaction kalau butuh pasti unik.
export function uniqueAmount(base: number): { base: number; code: number; pay: number } {
  const maxCode = Math.min(100, Math.max(9, Math.round(base * 0.01)));
  const code = Math.floor(Math.random() * maxCode) + 1;
  return { base, code, pay: base + code };
}
