import { requestOtp, verifyOtp, normalizePhone } from "../../services/gobizAuth";
import { loadSession, refreshSession } from "../../services/sessionManager";
import { setQrisStatic, setMerchantId, parseQrisTlv } from "../../services/qris";
import { decodeQRCodeFromImage } from "../../services/qrDecoder";
import { deleteGoBizSession, insertLog, listMerchantsByUser, listApiKeysByUser } from "../../db/queries";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { bad, reqMerchant, currentUserId } from "./helpers";

export async function settings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const mask = (v: string) => (v ? v.slice(0, 4) + "****" : "");
  const merchants = await listMerchantsByUser(DB, userId);
  const apiKeys = await listApiKeysByUser(DB, userId);
  return c.json({
    success: true,
    data: {
      merchants: merchants.map((m) => ({ id: m.id, type: m.type, name: m.name, status: m.status, gopay_merchant_id: m.gopay_merchant_id, qris_static_set: !!m.qris_static, qris_static_masked: m.qris_static ? m.qris_static.slice(0, 12) + "..." : "", created_at: m.created_at, updated_at: m.updated_at })),
      api_keys: apiKeys.map((k) => ({ id: k.id, label: k.label, key_masked: mask(k.key), status: k.status, last_used_at: k.last_used_at, created_at: k.created_at })),
    },
  });
}

export async function qrisParse(c: Context<AppEnv>) {
  const body = await c.req.json();
  const image = body?.image as string | undefined;
  if (!image) bad("Gambar QRIS (base64) wajib dikirim");
  const decoded = await decodeQRCodeFromImage(image);
  if (!decoded) bad("Tidak bisa membaca QRIS dari gambar. Pastikan gambar jelas dan utuh.");
  const tlv = parseQrisTlv(decoded);
  const merchantInfo = tlv["26"] || tlv["51"] || "";
  const sub = parseQrisTlv(merchantInfo);
  const merchantId = Object.values(sub).find((v) => /^G\d{9}$/.test(v)) || merchantInfo;
  return c.json({ success: true, data: { code: decoded, merchant_id: merchantId, merchant_name: tlv["59"], city: tlv["60"], type: tlv["01"] === "11" ? "static" : "dynamic" } });
}

export async function qrisStatic(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const body = await c.req.json();
  const code = body?.code as string | undefined;
  if (!code) bad("Kode QRIS wajib dikirim");
  await setQrisStatic(DB, merchantId, code);
  await insertLog(DB, "INFO", "QRIS static di-update | Merchant " + merchantId + " (" + code.slice(0, 12) + "...)");
  return c.json({ success: true });
}

export async function merchantId(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const body = await c.req.json();
  const id = body?.merchant_id as string | undefined;
  if (!id) bad("Merchant ID wajib dikirim");
  await setMerchantId(DB, merchantId, id);
  await insertLog(DB, "INFO", "Merchant ID di-update (" + id + ")");
  return c.json({ success: true });
}

export async function otpRequest(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if (!body?.phone) bad("Nomor HP wajib diisi");
  const { otpToken, expiresIn, uniqueId } = await requestOtp(body.phone);
  await insertLog(DB, "INFO", "OTP dikirim ke " + normalizePhone(body.phone).display);
  return c.json({ success: true, data: { otp_token: otpToken, expires_in: expiresIn, unique_id: uniqueId } });
}

export async function otpVerify(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const body = await c.req.json();
  if (!body?.phone || !body?.otp || !body?.otp_token) bad("phone, otp, otp_token wajib diisi");
  const session = await verifyOtp(body.phone, body.otp, body.otp_token, body.unique_id, DB, merchantId);
  await insertLog(DB, "SUCCESS", "Login GoBiz berhasil | " + session.phone_number + " | " + session.outlet_name + " | Merchant " + merchantId);
  return c.json({ success: true, data: { phone_number: session.phone_number, merchant_id: session.merchant_id, outlet_name: session.outlet_name, expires_at: session.expires_at } });
}

export async function refreshSessionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  const session = await loadSession(DB, merchantId);
  if (!session || !session.refresh_token) bad("Tidak ada sesi GoBiz untuk di-refresh. Login dulu.");
  const refreshed = await refreshSession(DB, merchantId);
  if (!refreshed) bad("Auto-refresh gagal. Login ulang diperlukan.", 502);
  await insertLog(DB, "INFO", "Admin memicu auto-refresh sesi GoBiz | Merchant " + merchantId);
  return c.json({ success: true, data: { expires_at: refreshed.expires_at } });
}

export async function deleteGoBizCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const merchantId = reqMerchant(c);
  await deleteGoBizSession(DB, merchantId);
  await insertLog(DB, "INFO", "Sesi GoBiz dihapus admin | Merchant " + merchantId + ". Perlu login OTP ulang.");
  return c.json({ success: true });
}