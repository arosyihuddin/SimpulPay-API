import { goBizHeaders, buildSession, saveSession } from "./sessionManager";
import { updateMerchant } from "../db/repositories";
import type { Db } from "../db/client";

export const GOBIZ_TOKEN_URL = "https://api.gobiz.co.id/goid/token";
export const GOBIZ_OTP_URL = "https://api.gobiz.co.id/goid/login/request";
export const GOBIZ_CONFIG_URL =
  "https://api.gobiz.co.id/goresto/v5/public/users/config";

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

function pickStr(obj: unknown, keys: string[]): string | undefined {
  const v = pick(obj, keys);
  return typeof v === "string" ? v : undefined;
}

// outlets di GoBiz bisa object tunggal atau array — normalisasi ke objek pertama.
function firstOutlet(v: unknown): Record<string, unknown> {
  const arr = Array.isArray(v) ? v : null;
  return asRecord(arr?.[0] ?? v);
}

export function extractConfig(data: Record<string, unknown>) {
  const merchant = asRecord(data.merchant);
  const merchants = Array.isArray(data.merchants) ? data.merchants : [];
  const firstMerchant = asRecord(merchants[0]);
  const merchantId =
    pickStr(merchant, ["merchant_id", "id"]) ??
    pickStr(firstMerchant, ["merchant_id", "id"]) ??
    asString(data.merchant_id) ??
    null;
  const outletName =
    asString(firstOutlet(merchant["outlets"])["name"]) ??
    asString(firstOutlet(firstMerchant["outlets"])["name"]) ??
    asString(firstOutlet(data["outlets"])["name"]) ??
    asString(asRecord(data["outlet"])["name"]) ??
    asString(data["outlet_name"]) ??
    asString(merchant["name"]) ??
    asString(firstMerchant["name"]) ??
    null;
  return { merchantId, outletName };
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object"
    ? (v as Record<string, unknown>)
    : {};
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function normalizePhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  const country = "62";
  const phone = digits.startsWith("62") ? digits.slice(2) : digits;
  return { phone, country, display: `+${country}${phone}` };
}

function goBizError(res: Response, json: any, fallback: string): never {
  const e = json?.errors?.[0];
  const msg = e?.message || e?.message_title || fallback;
  const err: any = new Error(msg);
  err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
  throw err;
}

export async function requestOtp(phoneInput: string) {
  const { phone, country } = normalizePhone(phoneInput);
  const uniqueId = crypto.randomUUID();
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
  const otpToken = json?.data?.otp_token ?? res.headers.get("set-cookie") ?? "";
  return { otpToken, expiresIn: json?.data?.expiry ?? 720, uniqueId };
}

export async function verifyOtp(
  phoneInput: string,
  otp: string,
  otpToken: string,
  uniqueId?: string,
  DB?: Db,
  merchantId?: string,
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

  let gopayMerchantId: string | null = null;
  let outletName: string | null = null;
  try {
    const cfgRes = await fetch(GOBIZ_CONFIG_URL, {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        ...goBizHeaders(),
      },
    });
    const cfg = (await cfgRes.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const rawData: unknown = cfg?.data;
    const extracted = extractConfig(
      rawData != null && typeof rawData === "object"
        ? (rawData as Record<string, unknown>)
        : cfg,
    );
    gopayMerchantId = extracted.merchantId;
    outletName = extracted.outletName;
  } catch {}

  const session = buildSession({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? "",
    phone_number: display,
    merchant_id: gopayMerchantId,
    outlet_name: outletName ?? "Merchant GoPay",
  });
  if (DB) {
    if (!merchantId) {
      const err: any = new Error("merchantId wajib untuk menyimpan sesi GoBiz");
      err.status = 400;
      throw err;
    }
    await saveSession(DB, merchantId, session);
    // Login OTP sukses = sesi GoBiz valid lagi → reaktivasi merchant.
    await updateMerchant(DB, merchantId, {
      gopayMerchantId: gopayMerchantId,
      name: outletName ?? undefined,
      status: "active",
    });
  }
  return session;
}
