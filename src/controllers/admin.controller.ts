// Controller admin: handler untuk semua endpoint /admin (login, dashboard, settings, otp)
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import * as pg from "pg";
import { PG_SCHEMA_SQL } from "../db/client";
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
  getUserByUsername,
  createUser,
  countUsers,
  updateUserPassword,
} from "../db/queries";
import {
  ADMIN_COOKIE,
  ADMIN_TTL_MS,
  getApiKey,
  adminOk,
} from "../middleware/guards";
import { broadcast } from "../services/realtime";
import {
  cookieToken,
  hashPassword,
  verifyPassword,
} from "../utils/auth.helper";

const SESSION_MAX_AGE = ADMIN_TTL_MS / 1000;

// Set-Cookie admin session. Deploy terpisah (frontend di host lain) butuh
// SameSite=None + Secure supaya cookie terkirim cross-site. Default Lax
// (same-origin aman, dev pakai http). Atur via env:
//   COOKIE_SAMESITE=None COOKIE_SECURE=true
function cookieHeader(token: string, maxAge: number): string {
  const sameSite = process.env.COOKIE_SAMESITE || "Lax";
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}
const authErr = () => {
  const err: any = new Error("Tidak terautentikasi atau sesi berakhir");
  err.status = 401;
  throw err;
};

function setEnvLine(lines: string[], key: string, value: string): void {
  const i = lines.findIndex((l) => l.trim().startsWith(key + "="));
  const line = `${key}=${value}`;
  if (i >= 0) {
    lines[i] = line;
  } else {
    const blank = lines.findIndex((l) => !l.trim());
    if (blank >= 0) lines[blank] = line;
    else lines.push(line);
  }
}

// Ambil transaksi bulan ini dari Gojek (dipakai dashboard)
async function fetchMonthTransactions() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  try {
    const raw = await fetchTransactionsWithRetry({
      startTime: startOfMonth.getTime(),
      endTime: now.getTime(),
      pageSize: 100,
    });
    return { success: true as const, raw };
  } catch (err: any) {
    return { success: false as const, message: err.message };
  }
}

function bad(message: string, status = 400): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

export async function setupStatus() {
  const configDone = !!process.env.DB_DRIVER;
  const needsSetup = Number(await countUsers()) === 0;
  return { needsSetup, configDone };
}

export async function setupDb(body: any) {
  const driver = body?.driver as string | undefined;
  if (driver !== "sqlite" && driver !== "postgres")
    bad("Driver harus 'sqlite' atau 'postgres'");
  if (driver === "postgres" && !body?.url)
    bad("DATABASE_URL wajib diisi untuk postgres");
  const envPath = path.join(import.meta.dirname, "..", "..", ".env");
  const fs = await import("node:fs");
  let lines: string[] = [];
  if (fs.existsSync(envPath))
    lines = fs.readFileSync(envPath, "utf-8").split("\n");

  if (driver === "postgres") {
    const testPool = new pg.Pool({ connectionString: body.url, max: 1 });
    try {
      await testPool.query("SELECT 1");
    } catch (err) {
      bad(`Koneksi Postgres gagal: ${(err as Error).message}`, 400);
    }
    try {
      for (const sql of PG_SCHEMA_SQL) await testPool.query(sql);
    } catch (err) {
      bad(`Migrasi skema Postgres gagal: ${(err as Error).message}`, 500);
    } finally {
      await testPool.end();
    }
  }

  setEnvLine(lines, "DB_DRIVER", driver);
  if (driver === "postgres") setEnvLine(lines, "DATABASE_URL", body.url);
  else setEnvLine(lines, "DATABASE_PATH", "./data/gateway.db");
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
  await insertLog("INFO", `Konfigurasi database disimpan: ${driver}`);
  // Restart cuma wajib kalau pindah engine. First-run default-nya sqlite aktiv,
  // jadi pilih sqlite bisa lanjut tanpa restart (DB yg lagi dipakai sudah sqlite).
  const activeDriver = process.env.DB_DRIVER || "sqlite";
  return { success: true, needsRestart: activeDriver !== driver, driver };
}

export async function setup(body: any, set: any) {
  if ((await countUsers()) > 0)
    bad("Setup sudah selesai. Logout lalu login.", 409);
  const username = (body?.username || "").trim();
  const password = body?.password || "";
  if (username.length < 3) bad("Username minimal 3 karakter");
  if (password.length < 8) bad("Password minimal 8 karakter");
  await createUser({
    id: randomUUID(),
    username,
    passwordHash: hashPassword(password),
  });
  const token = randomUUID();
  await createAdminSession(token, ADMIN_TTL_MS);
  await insertLog(
    "INFO",
    `Setup selesai: admin '${username}' dibuat. Login sukses.`,
  );
  set.headers["Set-Cookie"] = cookieHeader(token, SESSION_MAX_AGE);
  return { success: true };
}

export async function login(body: any, set: any) {
  const username = (body?.username || "").trim();
  const password = body?.password || "";
  if (!username || !password) bad("Username dan password wajib diisi", 401);
  const user = await getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    await insertLog("WARNING", "Percobaan login admin gagal");
    bad("Username atau password salah", 401);
  }
  const token = randomUUID();
  await createAdminSession(token, ADMIN_TTL_MS);
  await insertLog("INFO", `Admin login sukses: ${username}`);
  set.headers["Set-Cookie"] = cookieHeader(token, SESSION_MAX_AGE);
  return { success: true };
}

export async function logout(set: any, headers: any) {
  const token = cookieToken({ headers });
  if (token) {
    await deleteAdminSession(token);
    await insertLog("INFO", "Admin logout");
  }
  set.headers["Set-Cookie"] = cookieHeader("", 0);
  return { success: true };
}

export async function me(adminToken: any) {
  const s = await getAdminSession(adminToken as string);
  return {
    success: true,
    data: {
      session_expires_at: s?.expires_at ?? null,
      setup_done: (await countUsers()) > 0,
    },
  };
}

export async function changePassword(body: any) {
  const username = (body?.username || "").trim();
  const oldPassword = body?.old_password || "";
  const newPassword = body?.new_password || "";
  if (!username || !oldPassword || !newPassword)
    bad("Username, password lama, dan password baru wajib diisi");
  const user = await getUserByUsername(username);
  if (!user || !verifyPassword(oldPassword, user.password_hash))
    bad("Password lama salah", 401);
  if (newPassword.length < 8) bad("Password baru minimal 8 karakter");
  await updateUserPassword(user.id, hashPassword(newPassword));
  await insertLog("INFO", `Password admin '${username}' diubah`);
  return { success: true };
}

export async function dashboard() {
  const session = await loadSession();
  await markQRISExpired();
  const qrisAll = await listQRIS(100);
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIncome = qrisAll
    .filter((q) => q.status === "PAID" && q.created_at >= todayStart.getTime())
    .reduce((sum, q) => sum + q.amount, 0);
  const activeQris = qrisAll.filter(
    (q) => q.status === "PENDING" && q.expires_at > now,
  ).length;
  const tx = await fetchMonthTransactions();
  const monthIncome = tx.success
    ? tx.raw.reduce(
        (sum: number, t: any) =>
          sum + toRupiah(t.gross_amount || t.real_gross_amount),
        0,
      )
    : null;
  return {
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
  };
}

export async function createQris(body: any) {
  const amount = body?.amount;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
    bad("Nominal pembayaran tidak valid");
  const staticTemplate = await getQrisStatic();
  if (!staticTemplate)
    bad(
      "QRIS static belum dikonfigurasi. Upload QRIS static di Settings → Konfigurasi QRIS.",
      500,
    );
  const st = staticTemplate as string;
  const base = parseInt(String(amount), 10);
  const { code, pay } = uniqueAmount(base);
  const dynamicCode = generateDynamicQRIS(st, pay);
  const qrisId = Math.random().toString(36).substring(2, 10);
  const trxId =
    "TRX-" + Math.random().toString(36).substring(2, 10).toUpperCase();
  const now = Date.now();
  const expiresAt = now + qrisExpiryMs();
  await insertQRIS({
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
    "INFO",
    `Admin buat QRIS | TRX-ID: ${trxId} | Rp ${base} (+${code})`,
  );
  broadcast({
    type: "qris_created",
    scope: "admin",
    data: { id: qrisId, status: "PENDING" },
  });
  return {
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
  };
}

export async function listQris(query: any) {
  const limit = parseInt((query.limit as string) || "50", 10);
  const offset = parseInt((query.offset as string) || "0", 10);
  await markQRISExpired();
  return {
    success: true,
    data: {
      qris: await listQRIS(limit, offset),
      total: await countQRIS(),
    },
  };
}

export async function listTransactions(query: any) {
  const tx = await fetchMonthTransactions();
  if (!tx.success) return { success: false, data: { message: tx.message } };
  const total = tx.raw.length;
  const pageSize = parseInt((query.pageSize as string) || "20", 10);
  const page = parseInt((query.page as string) || "1", 10);
  const start = (page - 1) * pageSize;
  const formatted = tx.raw
    .slice(start, start + pageSize)
    .map(formatTransaction);
  return { success: true, data: { transactions: formatted, total } };
}

export async function listLogs(query: any) {
  const limit = parseInt((query.limit as string) || "100", 10);
  const offset = parseInt((query.offset as string) || "0", 10);
  return {
    success: true,
    data: {
      logs: await recentLogs(limit, offset),
      total: await countLogs(),
    },
  };
}

export async function settings() {
  const apiKey = await getApiKey();
  const mask = (v: string) => (v ? v.slice(0, 4) + "****" : "");
  const st = await getQrisStatic();
  return {
    success: true,
    data: {
      port: process.env.PORT,
      api_key_set: !!apiKey,
      api_key_masked: mask(apiKey),
      api_key: apiKey,
      qris_static_set: !!st,
      qris_static_masked: st ? st.slice(0, 12) + "..." : "",
      gopay_merchant_id: await getMerchantId(),
      gobiz_session_exists: !!(await loadSession()),
      database_path: process.env.DATABASE_PATH || "data/gateway.db",
    },
  };
}

export async function apiKey(body: any) {
  if (body?.action === "delete") {
    await setSetting("api_key", "");
    await insertLog("INFO", "API key dihapus");
    return { success: true, data: { api_key_set: false } };
  }
  const key = "gm_" + randomBytes(32).toString("hex");
  await setSetting("api_key", key);
  await insertLog("INFO", "API key digenerate baru");
  return {
    success: true,
    data: { api_key: key, api_key_masked: key.slice(0, 4) + "****" },
  };
}

export async function qrisParse(body: any) {
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
  return {
    success: true,
    data: {
      code: decoded,
      merchant_id: merchantId,
      merchant_name: tlv["59"],
      city: tlv["60"],
      type: tlv["01"] === "11" ? "static" : "dynamic",
    },
  };
}

export async function qrisStatic(body: any) {
  const code = body?.code as string | undefined;
  if (!code) bad("Kode QRIS wajib dikirim");
  await setQrisStatic(code);
  await insertLog(
    "INFO",
    `QRIS static di-update via Settings (${code.slice(0, 12)}...)`,
  );
  return { success: true };
}

export async function merchantId(body: any) {
  const id = body?.merchant_id as string | undefined;
  if (!id) bad("Merchant ID wajib dikirim");
  await setMerchantId(id);
  await insertLog("INFO", `Merchant ID di-update via Settings (${id})`);
  return { success: true };
}

export async function otpRequest(body: any) {
  if (!body?.phone) bad("Nomor HP wajib diisi");
  const { otpToken, expiresIn, uniqueId } = await requestOtp(body.phone);
  await insertLog(
    "INFO",
    `OTP dikirim ke ${normalizePhone(body.phone).display}`,
  );
  return {
    success: true,
    data: { otp_token: otpToken, expires_in: expiresIn, unique_id: uniqueId },
  };
}

export async function otpVerify(body: any) {
  if (!body?.phone || !body?.otp || !body?.otp_token)
    bad("phone, otp, otp_token wajib diisi");
  const session = await verifyOtp(
    body.phone,
    body.otp,
    body.otp_token,
    body.unique_id,
  );
  await insertLog(
    "SUCCESS",
    `Login GoBiz berhasil | ${session.phone_number} | ${session.outlet_name}`,
  );
  return {
    success: true,
    data: {
      phone_number: session.phone_number,
      merchant_id: session.merchant_id,
      outlet_name: session.outlet_name,
      expires_at: session.expires_at,
    },
  };
}

export async function refreshSessionCtl() {
  const session = await loadSession();
  if (!session || !session.refresh_token)
    bad("Tidak ada sesi GoBiz untuk di-refresh. Login dulu.");
  const refreshed = await refreshSession();
  if (!refreshed) bad("Auto-refresh gagal. Login ulang diperlukan.", 502);
  await insertLog("INFO", "Admin memicu auto-refresh sesi GoBiz");
  return { success: true, data: { expires_at: refreshed.expires_at } };
}

export async function deleteGoBizCtl() {
  await deleteGoBizSession();
  await insertLog(
    "INFO",
    "Sesi GoBiz dihapus admin. Diperlukan login OTP ulang.",
  );
  return { success: true };
}

// Guard: middleware autentikasi cookie admin (dipakai route)
export async function deriveAdmin(ctx: any) {
  const token = cookieToken(ctx);
  if (!(await adminOk(token))) authErr();
  return { adminToken: token };
}
