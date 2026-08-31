import { z } from "zod";

export const errorRes = z.object({
  success: z.literal(false),
  message: z.string(),
});

export const okRes = z.object({ success: z.literal(true) });

export const v1HealthRes = okRes.extend({
  message: z.string(),
  timestamp: z.unknown(),
});

export const createQrisReq = z.object({ amount: z.number().positive() });
export const createQrisRes = okRes.extend({
  data: z.object({
    qris_id: z.string(),
    trx_id: z.string(),
    qris_code: z.string(),
    amount: z.number(),
    unique_code: z.number(),
    amount_to_pay: z.number(),
    expires_at: z.string(),
  }),
});

export const getQrisRes = okRes.extend({
  data: z.object({
    qris_id: z.string(),
    trx_id: z.string(),
    amount: z.number(),
    base_amount: z.number(),
    unique_code: z.number(),
    status: z.string(),
    created_at: z.number(),
    expires_at: z.number(),
    paid: z.boolean(),
  }),
});

export const paymentCheckReq = z.object({
  amount: z.number().positive(),
  startTime: z.number().optional(),
  trx_id: z.string().optional(),
});
export const paymentCheckRes = okRes.extend({
  paid: z.boolean(),
  message: z.string().optional(),
  transaction: z.record(z.string(), z.unknown()).optional(),
});

export const transactionSchema = z.object({
  amount: z.number(),
  status: z.string(),
  time: z.unknown().optional(),
  issuer: z.string(),
  order_id: z.string().optional(),
  transaction_id: z.string().optional(),
});
export const transactionsRes = okRes.extend({
  total_amount: z.string(),
  data: z.object({ transactions: z.array(transactionSchema) }),
});

export const tokenStatusRes = okRes.extend({
  data: z.object({
    token_status: z.enum(["valid", "invalid"]),
    message: z.string(),
  }),
});

export const logsRes = okRes.extend({
  logs: z.array(z.record(z.string(), z.unknown())),
});

export const merchantStatusRes = okRes.extend({
  data: z.object({
    active: z.boolean(),
  }),
});
