import {
  createMerchant,
  listMerchantsByUser,
  countMerchantsByUser,
  updateMerchant,
  deleteMerchant,
  insertLog,
  getActivePlanForUser,
  insertTransaction,
} from "../../db/repositories";
import {
  requestOtp,
  verifyOtp,
  normalizePhone,
} from "../../services/gobizAuth";
import { loadSession, refreshSession } from "../../services/sessionManager";
import {
  parseQrisTlv,
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
} from "../../services/qris";
import { decodeQRCodeFromImage } from "../../services/qrDecoder";
import { formatTransaction } from "../../services/gojek";
import { getValidHeaders } from "../../services/sessionManager";
import { checkDailyPaidLimit } from "../../services/limits";
import { broadcast } from "../../services/realtime";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import {
  bad,
  currentUserId,
  paramId,
  fetchMonthTransactions,
  ownedActiveMerchant,
  ownedMerchant,
} from "./helpers";

export async function createMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const name = (body?.name || "").trim();
  if (name.length < 2) bad("Nama merchant minimal 2 karakter");
  const type = body?.type === "shopeepay" ? "shopeepay" : "gopay";

  const isAdmin = c.get("user")?.role === "admin";
  if (!isAdmin) {
    const active = await getActivePlanForUser(DB, userId);
    const limit = active?.plan.max_merchants ?? 1;
    const count = await countMerchantsByUser(DB, userId);
    if (count >= limit) {
      bad(
        `Batas maksimal ${limit} merchant untuk plan ${active?.plan.name ?? "Free"}. Upgrade plan untuk menambah merchant.`,
        403,
      );
    }
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
        merchant_id: m.merchant_id,
        qris_static_set: !!m.qris_static,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
    },
  });
}

/** Ringkasan merchant: hanya id + nama + status — untuk widget dashboard. */
export async function merchantSummary(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchants = await listMerchantsByUser(DB, userId);
  return c.json({
    success: true,
    data: {
      merchants: merchants.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
      })),
    },
  });
}

export async function updateMerchantCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const id = c.req.param("id") ?? "";
  const merchant = await ownedMerchant(DB, userId, id);
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
  const merchant = await ownedMerchant(DB, userId, id);
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

/** Buat QRIS dinamis → insert transaksi. Butuh merchant aktif milik user (dari :id path). */
export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
  const headers = await getValidHeaders(DB, merchant.id, undefined, true);
  if (!headers)
    bad(
      "Sesi GoBiz belum/tidak valid. Login OTP dulu di Settings → Login GoBiz.",
      403,
    );
  const body = await c.req.json();
  const base = parseInt(String(body?.amount ?? ""), 10);
  if (Number.isNaN(base) || base <= 0) bad("Nominal pembayaran tidak valid");
  const staticTemplate = await getQrisStatic(DB, merchant.id);
  if (!staticTemplate)
    bad(
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
      500,
    );
  const blocked = await checkDailyPaidLimit(DB, merchant.id);
  if (blocked)
    bad(
      `Batas transaksi harian tercapai (${blocked.used}/${blocked.limit}). Silakan upgrade plan atau coba besok.`,
      429,
    );
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(staticTemplate, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  await insertTransaction(DB, {
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    merchantId: merchant.id,
    userId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(
    DB,
    "INFO",
    "Admin buat QRIS | Merchant " +
      merchant.id +
      " | TRX-ID: " +
      trxId +
      " | Rp " +
      base +
      " (+" +
      code +
      ")",
  );
  broadcast(c.env, {
    type: "qris_created",
    userId,
    data: {
      id: qrisId,
      trx_id: trxId,
      merchantId: merchant.id,
      amount_to_pay: pay,
      status: "pending",
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
  broadcast(c.env, {
    type: "log",
    userId,
    data: {
      type: "INFO",
      message: "QRIS dibuat: Rp" + base + " (+" + code + ")",
      created_at: now,
    },
  });
  const stub = c.env.APP_HUB.get(c.env.APP_HUB.idFromName("global"));
  c.executionCtx.waitUntil(stub.fetch("http://internal/start-pooling"));
  return c.json({
    success: true,
    data: {
      qris_id: qrisId,
      trx_id: trxId,
      qris_code: dynamicCode,
      amount: base,
      unique_code: code,
      amount_to_pay: pay,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
}

export async function qrisParse(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
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
  if (/^G\d{9}$/.test(gopayId)) {
    const patch: { qrisStatic: string; gopayMerchantId?: string } = {
      qrisStatic: decoded,
    };
    if (merchant.merchant_id !== gopayId) patch.gopayMerchantId = gopayId;
    await updateMerchant(DB, merchant.id, patch);
    await insertLog(
      DB,
      "INFO",
      "QRIS static di-update | Merchant " +
        merchant.id +
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
      matched: merchant.merchant_id === gopayId,
    },
  });
}

export async function otpRequest(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  await ownedMerchant(DB, userId, merchantId);
  const body = await c.req.json();
  if (!body?.phone) bad("Nomor HP wajib diisi");
  const { otpToken, expiresIn, uniqueId } = await requestOtp(body.phone);
  await insertLog(
    DB,
    "INFO",
    "OTP dikirim ke " + normalizePhone(body.phone).display,
    null,
    userId,
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
  const merchant = await ownedMerchant(DB, userId, merchantId);
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

/** Transaksi LIVE GoBiz — detail per merchant, butuh merchant aktif milik user. */
export async function merchantTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const merchantId = paramId(c);
  const merchant = await ownedActiveMerchant(DB, userId, merchantId);
  const q = c.req.query();
  const tx = await fetchMonthTransactions(DB, merchant.id);
  if (!tx.success) return c.json({ success: false, message: tx.message });
  const total = tx.raw.length;
  const pageSize = parseInt((q.pageSize as string) || "20", 10);
  const page = parseInt((q.page as string) || "1", 10);
  const formatted = tx.raw
    .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    .map(formatTransaction);
  return c.json({ success: true, data: { transactions: formatted, total } });
}
