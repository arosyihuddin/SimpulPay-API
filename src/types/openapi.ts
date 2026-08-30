import { z } from "zod";

// --- Shared response schema ---
export const errorRes = z.object({
  success: z.literal(false),
  message: z.string(),
});
export type ErrorRes = z.infer<typeof errorRes>;

export const okRes = z.object({ success: z.literal(true) });

// --- Public ---
export const qrStatusRes = z.object({
  success: z.boolean(),
  paid: z.boolean(),
  status: z.enum(["PENDING", "PAID", "EXPIRED", "NOT_FOUND"]),
  message: z.string().optional(),
  transaction: z.record(z.string(), z.unknown()).optional(),
});
export type QrStatusRes = z.infer<typeof qrStatusRes>;

// --- API v1 ---
export const v1HealthRes = okRes.extend({
  message: z.string(),
  timestamp: z.unknown(),
});

export const createQrisReq = z.object({ amount: z.number().positive() });
export const createQrisRes = okRes.extend({
  data: z.object({
    qris_id: z.string(),
    trx_id: z.string(),
    qris_url: z.string(),
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
    merchant_id: z.string().nullable(),
    qris_static_set: z.boolean(),
    gobiz_session_exists: z.boolean(),
    token_status: z.enum(["valid", "invalid"]),
    message: z.string(),
  }),
});

export const merchantSchema = z.object({
  id: z.string(),
  type: z.enum(["gopay", "shopeepay"]),
  name: z.string(),
  status: z.enum(["active", "inactive"]),
  gopay_merchant_id: z.string().nullable(),
  qris_static_set: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});
export const listMerchantsRes = okRes.extend({
  data: z.object({ merchants: z.array(merchantSchema) }),
});
export const createMerchantReq = z.object({
  name: z.string().min(2),
  type: z.enum(["gopay", "shopeepay"]).optional(),
  gopay_merchant_id: z.string().optional(),
  qris_static: z.string().optional(),
});
export const updateMerchantReq = z.object({
  name: z.string().min(2).optional(),
  type: z.enum(["gopay", "shopeepay"]).optional(),
  gopay_merchant_id: z.string().nullable().optional(),
  qris_static: z.string().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export const apiKeySchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  key_masked: z.string(),
  status: z.enum(["active", "revoked"]),
  last_used_at: z.number().nullable(),
  created_at: z.number(),
});
export const listApiKeysRes = okRes.extend({
  data: z.object({ api_keys: z.array(apiKeySchema) }),
});
export const createApiKeyReq = z.object({ label: z.string().optional() });
export const createApiKeyRes = okRes.extend({
  data: z.object({
    id: z.string(),
    api_key: z.string(),
    api_key_masked: z.string(),
  }),
});
export const notificationSchema = z.object({
  id: z.number(),
  user_id: z.string(),
  merchant_id: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  message: z.string(),
  data_json: z.string().nullable(),
  read: z.boolean(),
  created_at: z.number(),
});
export const listNotificationsRes = okRes.extend({
  data: z.object({
    notifications: z.array(notificationSchema),
    unread: z.number(),
  }),
});

// --- Admin (matching responses) ---
export const setupStatusRes = z.object({
  needsSetup: z.boolean(),
  configDone: z.boolean(),
});
export const setupRes = okRes;
export const loginReq = z.object({ username: z.string(), password: z.string() });
export const loginRes = okRes;
export const changePasswordReq = z.object({
  username: z.string(),
  old_password: z.string(),
  new_password: z.string().min(8),
});
export const meRes = z.object({
  success: z.boolean(),
  data: z.object({
    session_expires_at: z.number().nullable(),
    setup_done: z.boolean(),
    role: z.string(),
    username: z.string().nullable(),
  }),
});
export const dashboardRes = okRes.extend({
  data: z.record(z.string(), z.unknown()),
});
export const listQrisRes = okRes.extend({
  data: z.object({
    qris: z.array(z.record(z.string(), z.unknown())),
    total: z.number(),
  }),
});
export const createUserReq = z.object({
  username: z.string().min(3),
  password: z.string().min(8),
  role: z.enum(["admin", "customer"]).optional(),
});
export const updateUserReq = z.object({
  username: z.string().min(3).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["admin", "customer"]).optional(),
  status: z.enum(["active", "suspended", "banned"]).optional(),
});
export const apiKeyRes = okRes.extend({
  data: z.object({
    api_key: z.string().optional(),
    api_key_masked: z.string().optional(),
    api_key_set: z.boolean().optional(),
  }),
});
export const qrisStaticReq = z.object({ code: z.string() });
export const merchantIdReq = z.object({ merchant_id: z.string() });
export const otpRequestReq = z.object({ phone: z.string() });
export const otpRequestRes = okRes.extend({
  data: z.object({
    otp_token: z.string(),
    expires_in: z.number(),
    unique_id: z.string(),
  }),
});
export const otpVerifyReq = z.object({
  phone: z.string(),
  otp: z.string(),
  otp_token: z.string(),
  unique_id: z.string().optional(),
});
export const otpVerifyRes = okRes.extend({
  data: z.object({
    phone_number: z.string(),
    merchant_id: z.string().nullable(),
    outlet_name: z.string(),
    expires_at: z.string(),
  }),
});
export const refreshSessionRes = okRes.extend({
  data: z.object({ expires_at: z.string() }),
});
export const deleteGoBizRes = okRes;
export const qrisParseReq = z.object({ image: z.string() });
export const qrisParseRes = okRes.extend({
  data: z.object({
    code: z.string(),
    merchant_id: z.string(),
    merchant_name: z.string().optional(),
    city: z.string().optional(),
    type: z.string(),
  }),
});

export const listUsersRes = okRes.extend({
  data: z.object({
    users: z.array(
      z.object({
        id: z.string(),
        username: z.string(),
        role: z.string(),
        created_at: z.number(),
        updated_at: z.number(),
      }),
    ),
    total: z.number(),
  }),
});

export const settingsRes = okRes.extend({
  data: z.object({
    merchants: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["gopay", "shopeepay"]),
        name: z.string(),
        status: z.enum(["active", "inactive"]),
        gopay_merchant_id: z.string().nullable(),
        qris_static_set: z.boolean(),
        qris_static_masked: z.string(),
        created_at: z.number(),
        updated_at: z.number(),
      }),
    ),
    api_keys: z.array(
      z.object({
        id: z.string(),
        label: z.string().nullable(),
        key_masked: z.string(),
        status: z.enum(["active", "revoked"]),
        last_used_at: z.number().nullable(),
        created_at: z.number(),
      }),
    ),
  }),
});
