import { ADMIN_TTL_MS, getApiKey } from "../middleware/guards";
import {
  cookieToken,
  hashPassword,
  verifyPassword,
} from "../utils/auth.helper";
import {
  insertQRIS,
  listQRIS,
  countQRIS,
  markQRISExpired,
  insertLog,
  recentLogs,
  countLogs,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
  deleteGoBizSession,
  setSetting,
} from "../db/queries";
import {
  listUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  updateUserPassword,
  deleteUser,
  countUsers,
} from "../db/repositories/user.repository";
import type { Context } from "hono";
import type { Db } from "../db/client";
import type { AppEnv } from "../types";
import { getDb } from "../db/client";
import {
  loadSession,
  isExpired,
  refreshSession,
} from "../services/sessionManager";
import {
  generateDynamicQRIS,
  qrisExpiryMs,
  uniqueAmount,
  getQrisStatic,
  setQrisStatic,
  setMerchantId,
  getMerchantId,
  parseQrisTlv,
} from "../services/qris";
import { decodeQRCodeFromImage } from "../services/qrDecoder";
import { requestOtp, verifyOtp, normalizePhone } from "../services/gobizAuth";
import {
  fetchTransactionsWithRetry,
  formatTransaction,
  toRupiah,
} from "../services/gojek";
import { broadcast } from "../services/realtime";

const SESSION_MAX_AGE = ADMIN_TTL_MS / 1000;

function cookieHeader(token: string, maxAge: number): string {
  const sameSite = "None";
  const secure = "; Secure";
  return `${"gopay_admin_session"}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}

function bad(message: string, status = 400): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

async function fetchMonthTransactions(DB: Db) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const raw = await fetchTransactionsWithRetry(DB, {
      startTime: startOfMonth.getTime(),
      endTime: now.getTime(),
      pageSize: 100,
    });
    return { success: true as const, raw };
  } catch (err: any) {
    return { success: false as const, message: err.message };
  }
}

export async function setupStatus(c: Context<AppEnv>) {
  const DB = getDb(c);
  const needsSetup = (await countUsers(DB)) === 0;
  return c.json({ needsSetup, configDone: true });
}

export async function setup(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if ((await countUsers(DB)) > 0)
    bad("Setup sudah selesai. Logout lalu login.", 409);
  const username = (body?.username || "").trim();
  const password = body?.password || "";
  if (username.length < 3) bad("Username minimal 3 karakter");
  if (password.length < 8) bad("Password minimal 8 karakter");
  const id = crypto.randomUUID();
  await createUser(DB, {
    id,
    username,
    passwordHash: await hashPassword(password),
    role: "admin",
  });
  const token = crypto.randomUUID();
  await createAdminSession(DB, token, ADMIN_TTL_MS, id);
  await insertLog(
    DB,
    "INFO",
    `Setup selesai: admin '${username}' dibuat. Login sukses.`,
  );
  c.header("Set-Cookie", cookieHeader(token, SESSION_MAX_AGE));
  return c.json({ success: true });
}

export async function login(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const username = (body?.username || "").trim();
  const password = body?.password || "";
  if (!username || !password) bad("Username dan password wajib diisi", 401);
  const user = await getUserByUsername(DB, username);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await insertLog(DB, "WARNING", "Percobaan login admin gagal");
    bad("Username atau password salah", 401);
  }
  const token = crypto.randomUUID();
  await createAdminSession(DB, token, ADMIN_TTL_MS, user.id);
  await insertLog(DB, "INFO", `Admin login sukses: ${username}`);
  c.header("Set-Cookie", cookieHeader(token, SESSION_MAX_AGE));
  return c.json({ success: true });
}

export async function logout(c: Context<AppEnv>) {
  const DB = getDb(c);
  const token = cookieToken(c);
  if (token) {
    await deleteAdminSession(DB, token);
    await insertLog(DB, "INFO", "Admin logout");
  }
  c.header("Set-Cookie", cookieHeader("", 0));
  return c.json({ success: true });
}

export async function me(c: Context<AppEnv>) {
  const DB = getDb(c);
  const token = c.get("adminToken") as string;
  const s = await getAdminSession(DB, token);
  const userCount = await countUsers(DB);
  // role dari user pemilik sesi (fallback: sesi lama tanpa user_id => admin)
  let role = "admin";
  let username = null;
  if (s?.user_id) {
    const u = await getUserById(DB, s.user_id);
    if (u) {
      role = u.role;
      username = u.username;
    }
  }
  return c.json({
    success: true,
    data: {
      session_expires_at: s?.expires_at ?? null,
      setup_done: userCount > 0,
      role,
      username,
    },
  });
}

export async function changePassword(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const username = (body?.username || "").trim();
  const oldPassword = body?.old_password || "";
  const newPassword = body?.new_password || "";
  if (!username || !oldPassword || !newPassword)
    bad("Username, password lama, dan password baru wajib diisi");
  const user = await getUserByUsername(DB, username);
  if (!user || !(await verifyPassword(oldPassword, user.password_hash)))
    bad("Password lama salah", 401);
  if (newPassword.length < 8) bad("Password baru minimal 8 karakter");
  await updateUserPassword(DB, user.id, await hashPassword(newPassword));
  await insertLog(DB, "INFO", `Password admin '${username}' diubah`);
  return c.json({ success: true });
}

export async function listUsersCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const users = (await listUsers(DB, limit, offset)).map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role,
    created_at: u.created_at,
    updated_at: u.updated_at,
  }));
  return c.json({
    success: true,
    data: { users, total: await countUsers(DB) },
  });
}

export async function createUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const username = (body?.username || "").trim();
  const password = body?.password || "";
  const role = (body?.role || "user").trim();
  if (username.length < 3) bad("Username minimal 3 karakter");
  if (password.length < 8) bad("Password minimal 8 karakter");
  if (await getUserByUsername(DB, username)) bad("Username sudah dipakai", 409);
  if (!["admin", "user"].includes(role)) bad("Role harus 'admin' atau 'user'");
  const id = crypto.randomUUID();
  await createUser(DB, {
    id,
    username,
    passwordHash: await hashPassword(password),
    role,
  });
  await insertLog(DB, "INFO", `User dibuat: ${username} (${role})`);
  return c.json({ success: true, data: { id } });
}

export async function updateUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const existing = await getUserById(DB, id);
  if (!existing) bad("User tidak ditemukan", 404);
  const body = await c.req.json();
  const patch: { username?: string; role?: string; passwordHash?: string } = {};
  if (body?.username !== undefined) {
    const username = String(body.username).trim();
    if (username.length < 3) bad("Username minimal 3 karakter");
    const dup = await getUserByUsername(DB, username);
    if (dup && dup.id !== id) bad("Username sudah dipakai", 409);
    patch.username = username;
  }
  if (body?.role !== undefined) {
    const role = String(body.role).trim();
    if (!["admin", "user"].includes(role))
      bad("Role harus 'admin' atau 'user'");
    patch.role = role;
  }
  if (body?.password) {
    if (String(body.password).length < 8) bad("Password minimal 8 karakter");
    patch.passwordHash = await hashPassword(String(body.password));
  }
  await updateUser(DB, id, patch);
  await insertLog(DB, "INFO", `User diubah: ${existing.username}`);
  return c.json({ success: true });
}

export async function deleteUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const existing = await getUserById(DB, id);
  if (!existing) bad("User tidak ditemukan", 404);
  // cegah admin menghapus dirinya sendiri
  const s = await getAdminSession(DB, c.get("adminToken") as string);
  if (s?.user_id === id)
    bad("Tidak bisa menghapus akun yang sedang dipakai", 409);
  await deleteUser(DB, id);
  await insertLog(DB, "INFO", `User dihapus: ${existing.username}`);
  return c.json({ success: true });
}

export async function dashboard(c: Context<AppEnv>) {
  const DB = getDb(c);
  const session = await loadSession(DB);
  await markQRISExpired(DB);
  const qrisAll = await listQRIS(DB, 100);
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIncome = qrisAll
    .filter((q) => q.status === "PAID" && q.created_at >= todayStart.getTime())
    .reduce((sum, q) => sum + q.amount, 0);
  const activeQris = qrisAll.filter(
    (q) => q.status === "PENDING" && q.expires_at > now,
  ).length;
  const tx = await fetchMonthTransactions(DB);
  const monthIncome = tx.success
    ? tx.raw.reduce(
        (sum: number, t: any) =>
          sum + toRupiah(t.gross_amount || t.real_gross_amount),
        0,
      )
    : null;
  return c.json({
    success: true,
    data: {
      stats: {
        today_income: todayIncome,
        month_income: monthIncome,
        total_transactions: tx.success ? tx.raw.length : null,
        active_qris: activeQris,
        total_qris: qrisAll.length,
      },
      gobiz_session: session
        ? {
            exists: true,
            phone: session.phone_number,
            outlet: session.outlet_name,
            merchant_id: session.merchant_id,
            expired: isExpired(session),
            expires_at: session.expires_at,
          }
        : { exists: false },
      month_fetch_error: tx.message ?? null,
    },
  });
}

export async function createQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    bad("Nominal pembayaran tidak valid");
  const staticTemplate = await getQrisStatic(DB);
  if (!staticTemplate)
    bad(
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
      500,
    );
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(staticTemplate, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  await insertQRIS(DB, {
    id: qrisId,
    code: dynamicCode!,
    amount: pay,
    baseAmount: base,
    uniqueCode: code,
    trxId,
    createdAt: now,
    expiresAt,
  });
  await insertLog(
    DB,
    "INFO",
    `Admin buat QRIS | TRX-ID: ${trxId} | Rp ${base} (+${code})`,
  );
  broadcast(c.env, {
    type: "qris_created",
    scope: "admin",
    data: { id: qrisId, status: "PENDING" },
  });
  return c.json({
    success: true,
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

export async function listQris(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  await markQRISExpired(DB);
  return c.json({
    success: true,
    data: {
      qris: await listQRIS(DB, limit, offset),
      total: await countQRIS(DB),
    },
  });
}

export async function listTransactions(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const tx = await fetchMonthTransactions(DB);
  if (!tx.success)
    return c.json({ success: false, data: { message: tx.message } });
  const total = tx.raw.length;
  const pageSize = parseInt((q.pageSize as string) || "20", 10);
  const page = parseInt((q.page as string) || "1", 10);
  const start = (page - 1) * pageSize;
  const formatted = tx.raw
    .slice(start, start + pageSize)
    .map(formatTransaction);
  return c.json({ success: true, data: { transactions: formatted, total } });
}

export async function listLogs(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "100", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  return c.json({
    success: true,
    data: {
      logs: await recentLogs(DB, limit, offset),
      total: await countLogs(DB),
    },
  });
}

export async function settings(c: Context<AppEnv>) {
  const DB = getDb(c);
  const apiKey = await getApiKey(DB);
  const mask = (v: string) => (v ? v.slice(0, 4) + "****" : "");
  const st = await getQrisStatic(DB);
  return c.json({
    success: true,
    data: {
      api_key_set: !!apiKey,
      api_key_masked: mask(apiKey),
      api_key: apiKey,
      qris_static_set: !!st,
      qris_static_masked: st ? st.slice(0, 12) + "..." : "",
      gopay_merchant_id: await getMerchantId(DB),
      gobiz_session_exists: !!(await loadSession(DB)),
    },
  });
}

export async function apiKey(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if (body?.action === "delete") {
    await setSetting(DB, "api_key", "");
    await insertLog(DB, "INFO", "API key dihapus");
    return c.json({ success: true, data: { api_key_set: false } });
  }
  const key =
    "gm_" + bufToHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await setSetting(DB, "api_key", key);
  await insertLog(DB, "INFO", "API key digenerate baru");
  return c.json({
    success: true,
    data: { api_key: key, api_key_masked: key.slice(0, 4) + "****" },
  });
}

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function qrisParse(c: Context<AppEnv>) {
  const body = await c.req.json();
  const image = body?.image as string | undefined;
  if (!image) bad("Gambar QRIS (base64) wajib dikirim");
  const decoded = await decodeQRCodeFromImage(image);
  if (!decoded)
    bad("Tidak bisa membaca QRIS dari gambar. Pastikan gambar jelas dan utuh.");
  const tlv = parseQrisTlv(decoded);
  const merchantInfo = tlv["26"] || tlv["51"] || "";
  const sub = parseQrisTlv(merchantInfo);
  const merchantId =
    Object.values(sub).find((v) => /^G\d{9}$/.test(v)) || merchantInfo;
  return c.json({
    success: true,
    data: {
      code: decoded,
      merchant_id: merchantId,
      merchant_name: tlv["59"],
      city: tlv["60"],
      type: tlv["01"] === "11" ? "static" : "dynamic",
    },
  });
}

export async function qrisStatic(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const code = body?.code as string | undefined;
  if (!code) bad("Kode QRIS wajib dikirim");
  await setQrisStatic(DB, code);
  await insertLog(
    DB,
    "INFO",
    `QRIS static di-update via Settings (${code.slice(0, 12)}...)`,
  );
  return c.json({ success: true });
}

export async function merchantId(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const id = body?.merchant_id as string | undefined;
  if (!id) bad("Merchant ID wajib dikirim");
  await setMerchantId(DB, id);
  await insertLog(DB, "INFO", `Merchant ID di-update via Settings (${id})`);
  return c.json({ success: true });
}

export async function otpRequest(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if (!body?.phone) bad("Nomor HP wajib diisi");
  const { otpToken, expiresIn, uniqueId } = await requestOtp(body.phone);
  await insertLog(
    DB,
    "INFO",
    `OTP dikirim ke ${normalizePhone(body.phone).display}`,
  );
  return c.json({
    success: true,
    data: { otp_token: otpToken, expires_in: expiresIn, unique_id: uniqueId },
  });
}

export async function otpVerify(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  if (!body?.phone || !body?.otp || !body?.otp_token)
    bad("phone, otp, otp_token wajib diisi");
  const session = await verifyOtp(
    body.phone,
    body.otp,
    body.otp_token,
    body.unique_id,
    DB,
  );
  await insertLog(
    DB,
    "SUCCESS",
    `Login GoBiz berhasil | ${session.phone_number} | ${session.outlet_name}`,
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
  const session = await loadSession(DB);
  if (!session || !session.refresh_token)
    bad("Tidak ada sesi GoBiz untuk di-refresh. Login dulu.");
  const refreshed = await refreshSession(DB);
  if (!refreshed) bad("Auto-refresh gagal. Login ulang diperlukan.", 502);
  await insertLog(DB, "INFO", "Admin memicu auto-refresh sesi GoBiz");
  return c.json({ success: true, data: { expires_at: refreshed.expires_at } });
}

export async function deleteGoBizCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  await deleteGoBizSession(DB);
  await insertLog(
    DB,
    "INFO",
    "Sesi GoBiz dihapus admin. Diperlukan login OTP ulang.",
  );
  return c.json({ success: true });
}
