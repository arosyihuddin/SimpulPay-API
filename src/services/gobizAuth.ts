// GoBiz OTP login
import { goBizHeaders, buildSession, saveSession } from "./sessionManager";
import { randomUUID } from "node:crypto";

export const GOBIZ_TOKEN_URL = "https://api.gobiz.co.id/goid/token";
export const GOBIZ_OTP_URL = "https://api.gobiz.co.id/goid/login/request";
export const GOBIZ_CONFIG_URL =
  "https://api.gobiz.co.id/goresto/v5/public/users/config";

// Cari field pertama yang terisi dari daftar kandidat path (deep-scan best-effort).
function pick(obj: unknown, keys: string[]): unknown {
  const candidates = Array.isArray(obj) ? obj : [obj];
  for (const cand of candidates) {
    if (typeof cand !== "object" || cand === null) continue;
    const rec = cand as Record<string, unknown>;
    for (const key of keys) {
      const v = rec[key];
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}
export function extractConfig(data: Record<string, unknown>) {
  const merchant = asRecord(data.merchant);
  const merchants = Array.isArray(data.merchants) ? data.merchants : [];
  const firstMerchant = asRecord(merchants[0]);

  const merchantId =
    (pick(merchant, ["merchant_id", "id"]) as string) ??
    (pick(firstMerchant, ["merchant_id", "id"]) as string) ??
    (asString(data.merchant_id) ?? null);

  const outletName =
    (pick(merchant.outlets, ["name"]) as string) ??
    (pick(firstMerchant.outlets, ["name"]) as string) ??
    (pick(asRecord(data.outlets), ["name"]) as string) ??
    (asString(asRecord(data.outlet).name) ?? null) ??
    (asString(data.outlet_name) ?? null) ??
    (asString(merchant.name) ?? null) ??
    (asString(firstMerchant.name) ?? null) ??
    null;

  return { merchantId, outletName };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Normalisasi nomor: "081234567890" -> { phone: "81234567890", country: "62", display: "+6281234567890" }
export function normalizePhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  const country = "62";
  const phone = digits.startsWith("62") ? digits.slice(2) : digits;
  return { phone, country, display: `+${country}${phone}` };
}

// Throw error dengan pesan friendly + status HTTP (biar bukan 500 semua)
function goBizError(res: Response, json: any, fallback: string): never {
  const e = json?.errors?.[0];
  const msg = e?.message || e?.message_title || fallback;
  const err: any = new Error(msg);
  err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
  throw err;
}

// Request OTP ke nomor HP. Return otp_token + uniqueId (dipakai verify OTP).
export async function requestOtp(phoneInput: string) {
  const { phone, country } = normalizePhone(phoneInput);
  const uniqueId = randomUUID();
  const res = await fetch(GOBIZ_OTP_URL, {
    method: "POST",
    headers: goBizHeaders(uniqueId),
    body: JSON.stringify({
      client_id: "go-biz-web-new",
      phone_number: phone,
      country_code: country,
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    goBizError(res, json, `Gagal mengirim OTP (HTTP ${res.status})`);
  }
  // otp_token diambil dari body response; fallback ke cookie bila tidak ada.
  const otpToken = json?.data?.otp_token ?? res.headers.get("set-cookie") ?? "";
  return { otpToken, expiresIn: json?.data?.expiry ?? 720, uniqueId };
}

// Verifikasi OTP + ambil info merchant + simpan sesi. Return session.
export async function verifyOtp(
  phoneInput: string,
  otp: string,
  otpToken: string,
  uniqueId?: string,
) {
  const { display } = normalizePhone(phoneInput);

  const tokenReq = await fetch(GOBIZ_TOKEN_URL, {
    method: "POST",
    headers: goBizHeaders(uniqueId),
    body: JSON.stringify({
      client_id: "go-biz-web-new",
      grant_type: "otp",
      data: { otp, otp_token: otpToken },
    }),
  });
  const tokenRes: any = await tokenReq.json().catch(() => ({}));
  const tokenData = tokenRes?.data ?? tokenRes;
  if (!tokenReq.ok || !tokenData?.access_token) {
    goBizError(
      tokenReq,
      tokenRes,
      `Verifikasi OTP gagal (HTTP ${tokenReq.status})`,
    );
  }

  let merchantId: string | null = null;
  let outletName: string | null = null;
  try {
    const cfgRes = await fetch(GOBIZ_CONFIG_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        ...goBizHeaders(),
      },
    });
    const cfg = (await cfgRes.json().catch(() => ({}))) as Record<string, unknown>;
    const rawData: unknown = cfg?.data;
    const extracted = extractConfig(
      (rawData != null && typeof rawData === "object"
        ? (rawData as Record<string, unknown>)
        : cfg),
    );
    merchantId = extracted.merchantId;
    outletName = extracted.outletName;
  } catch {
    // Abaikan — config opsional, fallback dipakai.
  }

  const session = buildSession({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? "",
    phone_number: display,
    merchant_id: merchantId,
    outlet_name: outletName ?? "Merchant GoPay",
  });
  await saveSession(session);
  return session;
}
