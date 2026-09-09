import { getMerchant, getUserSettings } from "../db/repositories";
import type { Db } from "../db/client";

/** Default settings gateway — cerminan DEFAULTS di settings controller. */
export const SETTINGS_DEFAULTS = {
  qris_expiry_minutes: "2",
  min_amount: "100",
  max_amount: "10000000",
  fee_percent: "0",
  pooling_interval: "8", // detik
} as const;

const num = (raw: string | undefined, fallback: number): number => {
  const v = parseFloat(String(raw ?? ""));
  return Number.isFinite(v) ? v : fallback;
};

/**
 * Settings milik pemilik merchant — batas/expiry/fee ikut merchant,
 * bukan pemanggil. Fallback ke default kalau user belum punya settings row.
 */
export async function merchantSettings(
  DB: Db,
  merchantId: string,
): Promise<Record<string, string>> {
  const m = await getMerchant(DB, merchantId);
  const rows = m ? await getUserSettings(DB, m.user_id) : {};
  return { ...SETTINGS_DEFAULTS, ...rows };
}

/** Expiry QRIS dari qris_expiry_minutes (menit), clamp 1–1440. */
export function qrisExpiryMs(s: Record<string, string>): number {
  const minutes = num(s.qris_expiry_minutes, 2);
  return Math.min(1440, Math.max(1, minutes)) * 60 * 1000;
}

/** Batas nominal dari min/max_amount — return pesan error atau null. */
export function amountLimitError(
  base: number,
  s: Record<string, string>,
): string | null {
  const min = num(s.min_amount, 0);
  const max = num(s.max_amount, 10_000_000);
  if (base < min) return `Nominal minimal Rp ${min.toLocaleString("id-ID")}`;
  if (max > 0 && base > max)
    return `Nominal maksimal Rp ${max.toLocaleString("id-ID")}`;
  return null;
}

/** Fee rupiah dari fee_percent, clamp 0–100. */
export function feeAmount(base: number, s: Record<string, string>): number {
  const pct = Math.min(100, Math.max(0, num(s.fee_percent, 0)));
  return Math.round((base * pct) / 100);
}

/**
 * pooling_interval disimpan detik; nilai legacy ≥1000 dibaca sebagai ms.
 * Clamp bawah 1 detik.
 */
export function poolingIntervalMs(
  s: Record<string, string>,
  fallbackMs = 8000,
): number {
  const v = parseFloat(String(s.pooling_interval ?? ""));
  if (!Number.isFinite(v) || v <= 0) return fallbackMs;
  const ms = v >= 1000 ? v : v * 1000;
  return Math.max(1000, ms);
}

/** Normalisasi nilai pooling ke detik (string) sebelum simpan/kembali. */
export function normalizePoolingInterval(raw: unknown): string {
  const v = parseFloat(String(raw ?? ""));
  if (!Number.isFinite(v) || v <= 0) return String(raw ?? "");
  return String(v >= 1000 ? Math.round(v / 1000) : v);
}
