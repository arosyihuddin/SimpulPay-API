// GoPay transaction client + verifyPayment
import { getValidHeaders, refreshSession } from "./sessionManager";
import { claimTx, getClaim, insertLog } from "../db/queries";
import { getMerchantId } from "./qris";

export const GOJEK_TRANSACTIONS_URL =
  "https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions";

// Header tambahan untuk request ke api.gojekapi.com
export function goBizAcceptHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "accept-language": "id",
    "authentication-type": "go-id",
    "gojek-country-code": "ID",
    "gojek-timezone": "Asia/Jakarta",
    "x-appid": "go-biz-web-dashboard",
    "x-appversion": "platform-v3.111.0-1708bc9a",
    "x-deviceos": "Web",
    "x-platform": "Web",
    "x-user-type": "merchant",
  };
}

// GoPay API kirim gross_amount dalam format sen (×100), bukan rupiah.
// Konversi ke rupiah biar konsisten dengan amount QRIS.
export function toRupiah(raw: unknown): number {
  return Math.floor(parseInt(String(raw || 0), 10) / 100);
}

// Flatten transaksi GoPay → bentuk ramah UI/API (buang field raw berantakan)
export function formatTransaction(tx: any) {
  return {
    amount: toRupiah(tx.gross_amount || tx.real_gross_amount),
    status: tx.transaction_status
      ? tx.transaction_status.toLowerCase()
      : "success",
    time: tx.transaction_time || tx.settlement_time,
    issuer: tx.qris_provider_aspi_issuer || "GoPay / Bank",
    order_id: tx.order_id,
    transaction_id: tx.id,
  };
}

// Ambil transaksi dari Gojek API (dengan retry auto-refresh saat 401)
export async function fetchGojekTransactions(
  headers: Record<string, string>,
  params: Record<string, string>,
  timeoutMs = 10000,
) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${GOJEK_TRANSACTIONS_URL}?${query}`, {
    headers: { ...headers, ...goBizAcceptHeaders() },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err: any = new Error(`Gojek API ${res.status}`);
    err.response = {
      status: res.status,
      data: await res.json().catch(() => ({})),
    };
    throw err;
  }
  return res.json();
}

// Status & payment type yang dipakai semua query transaksi
const TX_STATUSES = "SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND";
const TX_PAYMENT_TYPES =
  "QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD";

// Satu call transaksi dengan retry auto-refresh saat 401.
// Memusatkan: time-range format, param query, header, retry.
export async function fetchTransactionsWithRetry(
  opts: {
    userAgent?: string;
    startTime?: number | null;
    endTime?: number | null;
    merchantIdOverride?: string | null;
    pageSize?: number;
    size?: string;
  } = {},
): Promise<any[]> {
  const headers = await getValidHeaders(opts.userAgent);
  if (!headers) {
    throw new Error(
      "Sesi GoPay belum ada. Login OTP lewat dashboard (Settings → Login GoBiz).",
    );
  }
  const merchantId = opts.merchantIdOverride || (await getMerchantId());
  const now = Date.now();
  const startTimeISO = opts.startTime
    ? new Date(opts.startTime).toISOString()
    : new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const endTimeISO = opts.endTime
    ? new Date(opts.endTime).toISOString()
    : new Date(now).toISOString();

  const size = opts.size ?? String(opts.pageSize ?? 20);
  const pageSizeNum = parseInt(size, 10);

  const fetchPage = async (
    activeHeaders: Record<string, string>,
    from: string,
  ) =>
    fetchGojekTransactions(activeHeaders, {
      from,
      size,
      statuses: TX_STATUSES,
      payment_types: TX_PAYMENT_TYPES,
      start_time: startTimeISO,
      end_time: endTimeISO,
      merchant_ids: merchantId,
    });

  // 401-retry sekali per halaman (refresh sesi, ulang halaman yg sama)
  const pageWithRetry = async (
    activeHeaders: Record<string, string>,
    from: string,
  ) => {
    try {
      return await fetchPage(activeHeaders, from);
    } catch (firstErr) {
      if (
        (firstErr as any).response &&
        (firstErr as any).response.status === 401
      ) {
        insertLog("WARNING", "Sesi expired (401). Memulai auto-refresh...");
        const refreshed = await refreshSession();
        if (refreshed) {
          const newHeaders = await getValidHeaders(opts.userAgent);
          return await fetchPage(newHeaders!, from);
        }
      }
      throw firstErr;
    }
  };

  // Loop pagination: naikkan from sampai dapat halaman pendek (< size) → habis.
  // ponytail: API gak kasih total global yg reliable, jadi pakai heuristik panjang halaman.
  const all: any[] = [];
  const MAX_PAGES = 100;
  for (let from = 0; from / pageSizeNum < MAX_PAGES; from += pageSizeNum) {
    const response = (await pageWithRetry(headers, String(from))) as any;
    const page =
      response?.transactions ||
      response?.data?.transactions ||
      response?.data?.data ||
      [];
    all.push(...page);
    if (page.length === 0 || page.length < pageSizeNum) break;
  }
  return all;
}

// Core Helper: Verifikasi Pembayaran dari GoPay API
// qrisId: scope klaim — satu txId hanya bisa diklaim oleh satu qrisId
export async function verifyPayment(
  amount: unknown,
  startTime: unknown,
  merchantIdOverride: string | null = null,
  userAgent: string | null = null,
  qrisId: string | null = null,
) {
  const rawTransactions = await fetchTransactionsWithRetry({
    startTime: startTime ? (startTime as number) : undefined,
    merchantIdOverride,
    userAgent: userAgent || undefined,
    pageSize: 20,
  });
  const targetAmount = parseInt(amount as string, 10);
  const filterStartTimeMs = startTime
    ? new Date(startTime as number).getTime()
    : 0;

  for (const tx of rawTransactions) {
    const txAmount = toRupiah(
      tx.gross_amount || tx.real_gross_amount || tx.amount?.value || tx.amount,
    );
    const txTimestamp = new Date(
      tx.transaction_time || tx.created_at || tx.settlement_time || 0,
    ).getTime();
    const txId = tx.id || tx.order_id || tx.wallstreet_transaction_id;

    if (txAmount === targetAmount && txTimestamp >= filterStartTimeMs) {
      const existingClaim = await getClaim(txId);

      if (!existingClaim) {
        if (await claimTx(txId, qrisId)) {
          insertLog(
            "INFO",
            `TRX ${txId} diklaim oleh QRIS ${qrisId || "manual-check"}`,
          );
          return {
            transaction_id: txId,
            order_id: tx.order_id,
            amount: txAmount,
            payer_issuer: tx.qris_provider_aspi_issuer || "GoPay / Bank",
            payment_type:
              tx.payment_type || tx.transaction_source || "GOPAY_INSTORE",
            transaction_time: tx.transaction_time || tx.settlement_time,
          };
        }
      } else if (qrisId && existingClaim.qris_id === qrisId) {
        // Re-check dari QRIS yang sama → kembalikan hasil yang sudah diklaim
        return {
          transaction_id: txId,
          order_id: tx.order_id,
          amount: txAmount,
          payer_issuer: tx.qris_provider_aspi_issuer || "GoPay / Bank",
          payment_type:
            tx.payment_type || tx.transaction_source || "GOPAY_INSTORE",
          transaction_time: tx.transaction_time || tx.settlement_time,
        };
      } else {
        // Transaksi ini sudah diklaim oleh QRIS lain → skip, cari transaksi berikutnya
        insertLog(
          "INFO",
          `TRX ${txId} sudah diklaim oleh QRIS ${existingClaim.qris_id || "lain"}, skip untuk QRIS ${qrisId}`,
        );
        continue;
      }
    }
  }
  return null;
}
