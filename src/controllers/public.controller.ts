import QRCode from "qrcode";
import { getQRIS, markQRISPaid, markQRISExpired, insertLog } from "../db/queries";
import { verifyPayment } from "../services/gojek";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { getDb } from "../db/client";
import qrTpl from "../templates/qr.html";
import expiredTpl from "../templates/expired.html";

const render = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

async function qrSvgDataUri(data: string, size: number): Promise<string> {
  const svg = await QRCode.toString(data, {
    type: "svg",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return "data:image/svg+xml;base64," + btoa(svg);
}

export const health = (c: Context<AppEnv>) =>
  c.json({
    status: "OK",
    service: "GoPay Partner API Gateway",
    timestamp: new Date(),
  });

export const apiHealth = (c: Context<AppEnv>) =>
  c.json({
    success: true,
    message: "Layanan GoMerch API Berfungsi Normal",
    timestamp: new Date(),
  });

export async function qrPage(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const query = c.req.query();
  const qris = await getQRIS(DB, id);
  if (!qris)
    return c.html("<h3>Gambar QRIS tidak ditemukan atau telah dihapus</h3>", 404);

  if (qris.status === "PAID") {
    if (query.format === "raw" || query.raw === "1") {
      return c.body("QRIS Lunas", 200);
    }
    const tx = JSON.parse(qris.transaction_json || "{}");
    const initScript = `onPaymentSuccess({order_id:${JSON.stringify(tx.order_id ?? tx.transaction_id ?? null)},payer_issuer:${JSON.stringify(tx.payer_issuer ?? null)},transaction_time:${JSON.stringify(tx.transaction_time ?? null)}});`;
    const html = render(qrTpl, {
      AMOUNT: "",
      QR_IMAGE_URL: "",
      ID: qris.id,
      EXPIRES_TIMESTAMP: "0",
      PAYLOAD_SCRIPT: initScript,
    });
    return c.html(html);
  }

  if (Date.now() > qris.expires_at) {
    await markQRISExpired(DB);
    if (query.format === "raw" || query.raw === "1") {
      return c.body("QRIS Kedaluwarsa", 410);
    }
    return c.html(expiredTpl, 410);
  }

  if (query.format === "raw" || query.raw === "1") {
    const svg = await QRCode.toString(qris.code, {
      type: "svg",
      width: 300,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml; charset=utf-8" });
  }

  const formattedAmount = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(qris.amount);
  const qrImageUrl = await qrSvgDataUri(qris.code, 260);
  const html = render(qrTpl, {
    AMOUNT: formattedAmount,
    QR_IMAGE_URL: qrImageUrl,
    ID: qris.id,
    EXPIRES_TIMESTAMP: String(qris.expires_at),
  });
  return c.html(html);
}

export async function qrStatus(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const qris = await getQRIS(DB, id);
  if (!qris)
    return c.json({
      success: false,
      status: "NOT_FOUND",
      message: "QRIS tidak ditemukan",
    });

  if (qris.status === "PAID")
    return c.json({
      success: true,
      paid: true,
      status: "PAID",
      transaction: JSON.parse(qris.transaction_json || "{}"),
    });

  if (Date.now() > qris.expires_at) {
    await markQRISExpired(DB);
    return c.json({
      success: false,
      paid: false,
      status: "EXPIRED",
      message: "QRIS sudah kedaluwarsa",
    });
  }

  try {
    const matched = await verifyPayment(
      DB,
      qris.merchant_id || "",
      qris.amount,
      qris.created_at,
      null,
      c.req.header("user-agent"),
      qris.trx_id || id,
    );
    if (matched) {
      await markQRISPaid(DB, id, JSON.stringify(matched));
      await insertLog(DB, "SUCCESS", `Pembayaran QRIS ID ${id} terverifikasi lunas untuk nominal Rp ${qris.amount}`);
      return c.json({
        success: true,
        paid: true,
        status: "PAID",
        transaction: matched,
      });
    }
    return c.json({
      success: true,
      paid: false,
      status: "PENDING",
      message: "Belum ada pembayaran masuk",
    });
  } catch (err) {
    return c.json({
      success: false,
      paid: false,
      status: "PENDING",
      message: (err as Error).message,
    });
  }
}