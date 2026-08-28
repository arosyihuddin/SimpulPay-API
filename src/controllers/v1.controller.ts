// Controller API v1: handler untuk route publik terstruktur (bebas API key di guards)
import { getValidHeaders } from "../services/sessionManager";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
  getMerchantId,
} from "../services/qris";
import {
  fetchGojekTransactions,
  fetchTransactionsWithRetry,
  formatTransaction,
  verifyPayment,
} from "../services/gojek";
import {
  insertQRIS,
  getQRIS,
  markQRISExpired,
  insertLog,
  recentLogs,
} from "../db/queries";
import { ok, fail } from "../middleware/errorHandler";

export async function health() {
  return ok({
    message: "Layanan API GoPay Berfungsi Normal",
    timestamp: new Date(),
  });
}

export async function createQris(body: any) {
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    fail(400, "Nominal pembayaran tidak valid");
  }
  const st = await getQrisStatic();
  if (!st)
    fail(
      500,
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
    );
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(st, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  insertQRIS({
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    createdAt: now,
    expiresAt,
  });
  insertLog(
    "INFO",
    `QRIS dinamis dibuat via API v1 | TRX-ID: ${trxId} | Rp ${base} (+${code})`,
  );
  return ok({
    data: {
      qris_id: qrisId,
      trx_id: trxId,
      qris_url: `/qr/${qrisId}`,
      qris_code: dynamicCode,
      amount: base,
      unique_code: code,
      amount_to_pay: pay,
      expires_at: new Date(expiresAt).toISOString(),
    },
  });
}

export async function getQris(id: string) {
  const qris = await getQRIS(id);
  if (!qris) fail(404, "QRIS tidak ditemukan");
  const expired = Date.now() > qris.expires_at;
  if (expired) markQRISExpired();
  return ok({
    data: {
      qris_id: qris.id,
      trx_id: qris.trx_id,
      amount: qris.amount,
      base_amount: qris.base_amount,
      unique_code: qris.unique_code,
      status: expired ? "EXPIRED" : qris.status,
      created_at: qris.created_at,
      expires_at: qris.expires_at,
      paid: qris.status === "PAID",
    },
  });
}

export async function checkPayment(body: any, headers: any, query: any) {
  const amount = body?.amount || query.amount;
  const startTime =
    body?.startTime || query.startTime || query.start_time;
  const scopeId = body?.trx_id || query.trx_id || null;
  if (!amount || isNaN(Number(amount)))
    fail(400, "Nominal pembayaran tidak valid");
  try {
    const merchantId = headers["x-gopay-merchant-id"] || null;
    const matchedTransaction = await verifyPayment(
      amount,
      startTime,
      merchantId,
      headers["user-agent"],
      scopeId,
    );
    if (matchedTransaction) {
      insertLog(
        "SUCCESS",
        `Pembayaran terverifikasi lunas via API v1 | Rp ${parseInt(String(amount), 10)}`,
        matchedTransaction,
      );
      return ok({ paid: true, transaction: matchedTransaction });
    }
    return ok({
      paid: false,
      message: "Pembayaran belum ditemukan atau sudah pernah diklaim",
    });
  } catch (err) {
    const errAny: any = err;
    const errorDetail = errAny.response
      ? `HTTP ${errAny.response.status}: ${JSON.stringify(errAny.response.data)}`
      : errAny.message;
    insertLog(
      "ERROR",
      `Gagal periksa pembayaran via API v1: ${errorDetail}`,
    );
    fail(500, "Gagal mengambil data transaksi dari API GoPay", {
      error: errorDetail,
    });
  }
}

export async function listTransactions(query: any, headers: any) {
  try {
    const raw = await fetchTransactionsWithRetry({
      userAgent: headers["user-agent"],
      startTime: query.startTime
        ? parseInt(query.startTime as string, 10) * 1000
        : new Date(Date.now() - 3 * 24 * 3600 * 1000).getTime(),
      endTime: query.endTime
        ? parseInt(query.endTime as string, 10) * 1000
        : Date.now(),
      merchantIdOverride: headers["x-gopay-merchant-id"] || null,
      pageSize: parseInt((query.pageSize as string) || "20", 10),
    });
    const formatted = raw.map(formatTransaction);
    return ok({
      total_amount: String(
        formatted.reduce((a: number, t: any) => a + t.amount, 0),
      ),
      data: { transactions: formatted },
    });
  } catch (err) {
    fail(500, (err as Error).message);
  }
}

export async function monthTransactions(query: any, headers: any) {
  const now = new Date();
  const startOfMonthUnix = Math.floor(
    new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000,
  );
  (query as any).startTime = startOfMonthUnix;
  (query as any).pageSize = 100;
  const merchantId =
    headers["x-gopay-merchant-id"] || (await getMerchantId());
  try {
    const raw = await fetchTransactionsWithRetry({
      userAgent: headers["user-agent"],
      startTime: startOfMonthUnix * 1000,
      endTime: now.getTime(),
      merchantIdOverride: merchantId,
      pageSize: 100,
    });
    const formatted = raw.map(formatTransaction);
    return ok({
      total_amount: String(
        formatted.reduce((a: number, t: any) => a + t.amount, 0),
      ),
      data: { transactions: formatted },
    });
  } catch (err) {
    fail(500, (err as Error).message);
  }
}

export async function tokenStatus(headers: any) {
  const activeHeaders = await getValidHeaders(headers["user-agent"]);
  if (!activeHeaders)
    return ok({
      data: {
        token_status: "invalid",
        message: "Sesi belum dikonfigurasi. Login OTP di dashboard.",
      },
    });
  try {
    const merchantId = await getMerchantId();
    const now = new Date();
    const oneHourAgo = new Date(
      now.getTime() - 3600 * 1000,
    ).toISOString();
    await fetchGojekTransactions(activeHeaders, {
      from: "0",
      size: "1",
      statuses: "SETTLEMENT,CAPTURE",
      payment_types: "QRIS,GOPAY",
      start_time: oneHourAgo,
      end_time: now.toISOString(),
      merchant_ids: merchantId,
    });
    return ok({
      data: {
        token_status: "valid",
        message: "Token dan Sesi GoPay Merchant Aktif",
      },
    });
  } catch (err) {
    return ok({
      data: { token_status: "invalid", message: (err as Error).message },
    });
  }
}

export async function logs() {
  return ok({ logs: recentLogs() });
}