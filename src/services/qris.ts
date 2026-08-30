import { getMerchant, updateMerchant } from '../db/repositories';
import type { Db } from '../db/client';
const QRIS_EXPIRY_MS = 5 * 60 * 1000;

export { getMerchant };

export async function getQrisStatic(DB: Db, merchantId: string): Promise<string> {
  return (await getMerchant(DB, merchantId))?.qris_static || '';
}
export async function setQrisStatic(DB: Db, merchantId: string, code: string): Promise<void> {
  await updateMerchant(DB, merchantId, { qrisStatic: code });
}
export async function getMerchantId(DB: Db, merchantId: string): Promise<string> {
  return (await getMerchant(DB, merchantId))?.gopay_merchant_id || '';
}
export async function setMerchantId(DB: Db, merchantId: string, id: string): Promise<void> {
  await updateMerchant(DB, merchantId, { gopayMerchantId: id });
}

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

export function generateDynamicQRIS(staticTemplate: string, amount: unknown) {
  if (!staticTemplate) return null;
  let payload = staticTemplate.trim();

  const idx63 = payload.indexOf('6304');
  if (idx63 !== -1) {
    payload = payload.substring(0, idx63);
  }

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

export function uniqueAmount(base: number): { base: number; code: number; pay: number } {
  const maxCode = Math.min(100, Math.max(9, Math.round(base * 0.01)));
  const code = Math.floor(Math.random() * maxCode) + 1;
  return { base, code, pay: base + code };
}
