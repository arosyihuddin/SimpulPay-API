import { getValidHeaders } from "./sessionManager";
import {
  claimTx,
  getClaim,
  getMerchant,
  insertLog,
  insertNotification,
} from "../db/repositories";
import { getMerchantId } from "./qris";
import { checkDailyPaidLimit } from "./limits";
import { sendWebhook } from "./webhook";
import { notifyUser } from "./realtime";
import type { Db } from "../db/client";
import type { Env } from "../types";

const GOJEK_TRANSACTIONS_URL =
  "https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions";

function goBizAcceptHeaders() {
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

function toRupiah(raw: unknown): number {
  return Math.floor(parseInt(String(raw || 0), 10) / 100);
}

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

const TX_STATUSES = "SETTLEMENT,CAPTURE,REFUND,PARTIAL_REFUND";
const TX_PAYMENT_TYPES =
  "QRIS,GOPAY,OFFLINE_CREDIT_CARD,OFFLINE_DEBIT_CARD,CREDIT_CARD";

export async function fetchTransactionsWithRetry(
  DB: Db,
  merchantId: string,
  opts: {
    userAgent?: string;
    startTime?: number | null;
    endTime?: number | null;
    merchantIdOverride?: string | null;
    pageSize?: number;
    size?: string;
  } = {},
): Promise<any[]> {
  const headers = await getValidHeaders(DB, merchantId, opts.userAgent);
  if (!headers) {
    throw new Error(
      "Sesi GoPay belum ada. Login OTP lewat dashboard (Settings → Login GoBiz).",
    );
  }
  const gopayMerchantId =
    opts.merchantIdOverride || (await getMerchantId(DB, merchantId));
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
      merchant_ids: gopayMerchantId,
    });

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
        await insertLog(
          DB,
          "WARNING",
          "Sesi expired (401). Memulai auto-refresh...",
        );
        // getValidHeaders handle refresh + deactivate kalau gagal.
        const newHeaders = await getValidHeaders(
          DB,
          merchantId,
          opts.userAgent,
        );
        if (newHeaders) return await fetchPage(newHeaders, from);
      }
      throw firstErr;
    }
  };

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

export async function verifyPayment(
  env: Env,
  DB: Db,
  merchantId: string,
  amount: unknown,
  startTime: unknown,
  merchantIdOverride: string | null = null,
  userAgent: string | null = null,
  qrisId: string | null = null,
) {
  const rawTransactions = await fetchTransactionsWithRetry(DB, merchantId, {
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
      const existingClaim = await getClaim(DB, txId);

      if (!existingClaim) {
        const blocked = await checkDailyPaidLimit(DB, merchantId);
        if (blocked) {
          await insertLog(
            DB,
            "LIMIT",
            `Daily paid limit (${blocked.limit}) tercapai, TRX ${txId} ditolak`,
          );
          continue;
        }
        if (await claimTx(DB, txId, qrisId, merchantId)) {
          await insertLog(
            DB,
            "INFO",
            `TRX ${txId} diklaim oleh QRIS ${qrisId || "manual-check"}`,
          );
          const merchant = await getMerchant(DB, merchantId);
          if (merchant) {
            await insertNotification(DB, {
              userId: merchant.user_id,
              merchantId,
              type: "payment_success",
              title: "Pembayaran Berhasil",
              message: `Pembayaran Rp${txAmount.toLocaleString("id-ID")} diterima (TRX ${txId})`,
              dataJson: JSON.stringify({ txId, qrisId, amount: txAmount }),
            });
            notifyUser(env, merchant.user_id, {
              type: "notification",
              data: {
                title: "Pembayaran Berhasil",
                message: `Pembayaran Rp${txAmount.toLocaleString("id-ID")} diterima (TRX ${txId})`,
                type: "payment_success",
                created_at: Date.now(),
              },
            });
            await sendWebhook(DB, merchant.user_id, "transaction.paid", {
              transaction_id: txId,
              qris_id: qrisId,
              trx_id: tx.order_id ?? null,
              amount: txAmount,
              merchant_id: merchantId,
              merchant_name: merchant.name,
              paid_at: Date.now(),
            });
          }
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
      } else if (qrisId && existingClaim.transaction_id === qrisId) {
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
        await insertLog(
          DB,
          "INFO",
          `TRX ${txId} sudah diklaim oleh QRIS ${existingClaim.transaction_id || "lain"}, skip untuk QRIS ${qrisId}`,
        );
        continue;
      }
    }
  }
  return null;
}
