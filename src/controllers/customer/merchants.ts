import {
  createMerchant,
  getMerchant,
  listMerchantsByUser,
  countMerchantsByUser,
  updateMerchant,
  deleteMerchant,
  deleteGoBizSession,
  insertLog,
  getActiveSubscription,
  getPlan,
  getMerchantByUser,
  getMerchantByGopayId,
} from "../../db/repositories";
import {
  requestOtp,
  verifyOtp,
  normalizePhone,
} from "../../services/gobizAuth";
import { loadSession, refreshSession } from "../../services/sessionManager";
import { parseQrisTlv, setQrisStatic } from "../../services/qris";
import { decodeQRCodeFromImage } from "../../services/qrDecoder";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import type { Db } from "../../db/client";
import { getDb } from "../../db/client";
import { bad, currentUserId, paramId } from "./helpers";

/** Ambil merchant milik user dari :id path, cek status aktif. */
async function ownedActiveMerchant(DB: Db, userId: string, merchantId: string) {
  const m = await getMerchantByUser(DB, userId, merchantId);
  if (!m) bad("Merchant tidak ditemukan", 404);
  if (m.status !== "active") bad("Merchant tidak aktif", 403);
  return m;
}

export async function createMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const name = (body?.name || "").trim();
  if (name.length < 2) bad("Nama merchant minimal 2 karakter");
  const type = body?.type === "shopeepay" ? "shopeepay" : "gopay";

  // Limit per plan: hitung merchant yang udah dipakai, blokir kalau mentok.
  const sub = await getActiveSubscription(DB, userId);
  const plan = sub ? await getPlan(DB, sub.plan_id) : null;
  const limit = plan?.max_merchants ?? 1;
  const count = await countMerchantsByUser(DB, userId);
  if (count >= limit) {
    bad(
      `Batas maksimal ${limit} merchant untuk plan ${plan?.name ?? "Free"}. Upgrade plan untuk menambah merchant.`,
      403,
    );
  }

  const id = "m_" + crypto.randomUUID().slice(0, 8);
  await createMerchant(DB, {
    id,
    userId,
    name,
    type,
    gopayMerchantId: body?.gopay_merchant_id
      ? String(body.gopay_merchant_id)
      : null,
    qrisStatic: body?.qris_static ? String(body.qris_static) : null,
  });
  await insertLog(
    DB,
    "INFO",
    "Merchant dibuat: " + name + " (" + type + ")",
    null,
    userId,
  );
  return c.json({ success: true, data: { id } });
}

export async function listMerchantsCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchants = await listMerchantsByUser(DB, userId);
  return c.json({
    success: true,
    data: {
      merchants: merchants.map((m) => ({
        id: m.id,
        type: m.type,
        name: m.name,
        status: m.status,
        gopay_merchant_id: m.gopay_merchant_id,
        qris_static_set: !!m.qris_static,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
    },
  });
}

export async function updateMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const merchant = await getMerchant(DB, id);
  if (!merchant) bad("Merchant tidak ditemukan", 404);
  if (merchant.user_id !== userId) bad("Akses ditolak", 403);
  const body = await c.req.json();
  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) bad("Nama merchant minimal 2 karakter");
    patch.name = name;
  }
  if (body?.type !== undefined) {
    const type = String(body.type).trim();
    if (!["gopay", "shopeepay"].includes(type))
      bad("Type harus gopay atau shopeepay");
    patch.type = type;
  }
  if (body?.gopay_merchant_id !== undefined)
    patch.gopayMerchantId = body.gopay_merchant_id
      ? String(body.gopay_merchant_id)
      : null;
  if (body?.qris_static !== undefined)
    patch.qrisStatic = body.qris_static ? String(body.qris_static) : null;
  if (body?.status !== undefined) {
    const status = String(body.status).trim();
    if (!["active", "inactive"].includes(status))
      bad("Status harus active atau inactive");
    patch.status = status;
  }
  await updateMerchant(DB, id, patch);
  await insertLog(
    DB,
    "INFO",
    "Merchant diubah: " + merchant.name,
    null,
    userId,
  );
  return c.json({ success: true });
}

export async function deleteMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const merchant = await getMerchant(DB, id);
  if (!merchant) bad("Merchant tidak ditemukan", 404);
  if (merchant.user_id !== userId) bad("Akses ditolak", 403);
  await deleteGoBizSession(DB, id);
  await deleteMerchant(DB, id);
  await insertLog(
    DB,
    "INFO",
    "Merchant dihapus: " + merchant.name,
    null,
    userId,
  );
  return c.json({ success: true });
}

export async function qrisParse(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const image = body?.image as string | undefined;
  if (!image) bad("Gambar QRIS (base64) wajib dikirim");
  const decoded = await decodeQRCodeFromImage(image);
  if (!decoded)
    bad("Tidak bisa membaca QRIS dari gambar. Pastikan gambar jelas dan utuh.");
  const tlv = parseQrisTlv(decoded);
  const merchantInfo = tlv["26"] || tlv["51"] || "";
  const sub = parseQrisTlv(merchantInfo);
  const gopayId =
    Object.values(sub).find((v) => /^G\d{9}$/.test(v)) || merchantInfo;
  let matched = null;
  if (/^G\d{9}$/.test(gopayId)) {
    matched = await getMerchantByGopayId(DB, userId, gopayId);
  }
  if (matched && matched.status === "active") {
    await setQrisStatic(DB, matched.id, decoded);
    await insertLog(
      DB,
      "INFO",
      "QRIS static di-update | Merchant " +
        matched.id +
        " (" +
        decoded.slice(0, 12) +
        "...)",
      null,
      userId,
    );
  }
  return c.json({
    success: true,
    data: {
      code: decoded,
      merchant_id: gopayId,
      merchant_name: tlv["59"],
      city: tlv["60"],
      type: tlv["01"] === "11" ? "static" : "dynamic",
      matched_merchant: matched
        ? { id: matched.id, name: matched.name, status: matched.status }
        : null,
    },
  });
}

export async function otpRequest(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if (!body?.phone) bad("Nomor HP wajib diisi");
  const { otpToken, expiresIn, uniqueId } = await requestOtp(body.phone);
  await insertLog(
    DB,
    "INFO",
    "OTP dikirim ke " + normalizePhone(body.phone).display,
    null,
    currentUserId(c),
  );
  return c.json({
    success: true,
    data: { otp_token: otpToken, expires_in: expiresIn, unique_id: uniqueId },
  });
}

export async function otpVerify(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
  const body = await c.req.json();
  if (!body?.phone || !body?.otp || !body?.otp_token)
    bad("phone, otp, otp_token wajib diisi");
  const session = await verifyOtp(
    body.phone,
    body.otp,
    body.otp_token,
    body.unique_id,
    DB,
    merchant.id,
  );
  await insertLog(
    DB,
    "SUCCESS",
    "Login GoBiz berhasil | " +
      session.phone_number +
      " | " +
      session.outlet_name +
      " | Merchant " +
      merchant.id,
    null,
    userId,
  );
  return c.json({
    success: true,
    data: {
      phone_number: session.phone_number,
      merchant_id: session.merchant_id,
      outlet_name: session.outlet_name,
      expires_at: session.expires_at,
    },
  });
}

export async function refreshSessionCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
  const session = await loadSession(DB, merchant.id);
  if (!session || !session.refresh_token)
    bad("Tidak ada sesi GoBiz untuk di-refresh. Login dulu.");
  const refreshed = await refreshSession(DB, merchant.id);
  if (!refreshed) bad("Auto-refresh gagal. Login ulang diperlukan.", 502);
  await insertLog(
    DB,
    "INFO",
    "Admin memicu auto-refresh sesi GoBiz | Merchant " + merchant.id,
    null,
    userId,
  );
  return c.json({ success: true, data: { expires_at: refreshed.expires_at } });
}

export async function deleteGoBizCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
  await deleteGoBizSession(DB, merchant.id);
  await insertLog(
    DB,
    "INFO",
    "Sesi GoBiz dihapus admin | Merchant " +
      merchant.id +
      ". Perlu login OTP ulang.",
    null,
    userId,
  );
  return c.json({ success: true });
}
