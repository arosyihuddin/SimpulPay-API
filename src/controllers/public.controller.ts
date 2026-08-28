// Controller public: handler untuk halaman/customer QRIS (tanpa API key)
import QRCode from "qrcode";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  getQRIS,
  markQRISPaid,
  markQRISExpired,
  insertLog,
} from "../db/queries";
import { verifyPayment } from "../services/gojek";

const tplDir = join(dirname(fileURLToPath(import.meta.url)), "../templates");
const qrTpl = readFileSync(join(tplDir, "qr.html"), "utf8");
const expiredTpl = readFileSync(join(tplDir, "expired.html"), "utf8");

const render = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

async function qrSvgDataUri(data: string, size: number): Promise<string> {
  const svg = await QRCode.toString(data, {
    type: "svg",
    width: size,
    margin: 2,
    errorCorrectionLevel: "M",
  });
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

export const health = () => ({
  status: "OK",
  service: "GoPay Partner API Gateway",
  timestamp: new Date(),
});

export const apiHealth = () => ({
  success: true,
  message: "Layanan API GoPay Berfungsi Normal",
  timestamp: new Date(),
});

export async function qrPage(params: any, query: any) {
  const qris = await getQRIS(params.id);
  if (!qris)
    return new Response(
      "<h3>Gambar QRIS tidak ditemukan atau telah dihapus</h3>",
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  if (qris.status === "PAID") {
    if (query.format === "raw" || query.raw === "1") {
      return new Response("QRIS Lunas", { status: 200 });
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
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (Date.now() > qris.expires_at) {
    markQRISExpired();
    if (query.format === "raw" || query.raw === "1") {
      return new Response("QRIS Kedaluwarsa", { status: 410 });
    }
    return new Response(expiredTpl, {
      status: 410,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (query.format === "raw" || query.raw === "1") {
    const svg = await QRCode.toString(qris.code, {
      type: "svg",
      width: 300,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
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
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function qrStatus(id: string, headers: any) {
  const qris = await getQRIS(id);
  if (!qris)
    return {
      success: false,
      status: "NOT_FOUND",
      message: "QRIS tidak ditemukan",
    };
  if (qris.status === "PAID")
    return {
      success: true,
      paid: true,
      status: "PAID",
      transaction: JSON.parse(qris.transaction_json || "{}"),
    };
  if (Date.now() > qris.expires_at) {
    markQRISExpired();
    return {
      success: false,
      paid: false,
      status: "EXPIRED",
      message: "QRIS sudah kedaluwarsa",
    };
  }
  try {
    const matched = await verifyPayment(
      qris.amount,
      qris.created_at,
      null,
      headers["user-agent"],
      qris.trx_id || id,
    );
    if (matched) {
      markQRISPaid(id, JSON.stringify(matched));
      insertLog(
        "SUCCESS",
        `Pembayaran QRIS ID ${id} terverifikasi lunas untuk nominal Rp ${qris.amount}`,
      );
      return {
        success: true,
        paid: true,
        status: "PAID",
        transaction: matched,
      };
    }
    return {
      success: true,
      paid: false,
      status: "PENDING",
      message: "Belum ada pembayaran masuk",
    };
  } catch (err) {
    return {
      success: false,
      paid: false,
      status: "PENDING",
      message: (err as Error).message,
    };
  }
}