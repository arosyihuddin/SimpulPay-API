import { ADMIN_TTL_MS } from "../../middleware/guards";
import { hashPassword, verifyPassword } from "../../utils/auth.helper";
import {
  insertLog,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
} from "../../db/repositories";
import {
  getUserById,
  getUserByUsername,
  updateUserPassword,
  countUsers,
} from "../../db/repositories/user.repository";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { cookieToken } from "../../utils/auth.helper";
import { bad, cookieHeader, SESSION_MAX_AGE } from "./helpers";

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
  if (user.status !== "active")
    bad("Akun tidak aktif (suspended/banned). Hubungi admin.", 403);
  const token = crypto.randomUUID();
  await createAdminSession(DB, token, ADMIN_TTL_MS, user.id);
  await insertLog(DB, "INFO", "Admin login sukses: " + username);
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
  let role = "admin";
  let username = null;
  let status = "active";
  if (s?.user_id) {
    const u = await getUserById(DB, s.user_id);
    if (u) {
      role = u.role;
      username = u.username;
      status = u.status;
    }
  }
  return c.json({
    success: true,
    data: {
      session_expires_at: s?.expires_at ?? null,
      setup_done: userCount > 0,
      role,
      username,
      status,
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
  await insertLog(DB, "INFO", "Password admin '" + username + "' diubah");
  return c.json({ success: true });
}
