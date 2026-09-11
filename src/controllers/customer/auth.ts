import { ADMIN_TTL_MS } from "../../middleware/guards";
import {
  hashPassword,
  verifyPassword,
  isValidEmail,
} from "../../utils/auth.helper";
import {
  insertLog,
  createAdminSession,
  deleteAdminSession,
  getAdminSession,
} from "../../db/repositories";
import {
  getUserById,
  getUserByEmail,
  updateUser,
  updateUserPassword,
} from "../../db/repositories/user.repository";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { getDb } from "../../db/client";
import { cookieToken } from "../../utils/auth.helper";
import { bad, cookieHeader, SESSION_MAX_AGE, currentUserId } from "./helpers";

export async function login(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const email = (body?.email || "").trim().toLowerCase();
  const password = body?.password || "";
  if (!email || !password) bad("Email atau password salah", 401);
  const user = await getUserByEmail(DB, email);
  if (
    !user ||
    user.role !== "admin" ||
    !user.password_hash ||
    !(await verifyPassword(password, user.password_hash))
  ) {
    await insertLog(DB, "WARNING", "Percobaan login admin gagal");
    bad("Email atau password salah", 401);
  }
  if (user.status !== "active")
    bad("Akun tidak aktif (suspended/banned). Hubungi admin.", 403);
  const token = crypto.randomUUID();
  await createAdminSession(DB, token, ADMIN_TTL_MS, user.id);
  await insertLog(DB, "INFO", "Login sukses: " + email, null, user.id);
  c.header("Set-Cookie", cookieHeader(token, SESSION_MAX_AGE));
  return c.json({ success: true });
}

export async function logout(c: Context<AppEnv>) {
  const DB = getDb(c);
  const token = cookieToken(c);
  if (token) {
    const s = await getAdminSession(DB, token);
    await deleteAdminSession(DB, token);
    await insertLog(DB, "INFO", "Logout", null, s?.user_id);
  }
  c.header("Set-Cookie", cookieHeader("", 0));
  return c.json({ success: true });
}

export async function me(c: Context<AppEnv>) {
  const DB = getDb(c);
  const token = c.get("adminToken") as string;
  const s = await getAdminSession(DB, token);
  let role = "admin";
  let user = null;
  let status = "active";
  if (s?.user_id) {
    const u = await getUserById(DB, s.user_id);
    if (u) {
      role = u.role;
      status = u.status;
      user = u;
    }
  }
  return c.json({
    success: true,
    data: {
      id: user?.id ?? null,
      email: user?.email ?? null,
      name: user?.name ?? null,
      phone: user?.phone ?? null,
      role,
      status,
      created_at: user?.created_at ?? null,
      updated_at: user?.updated_at ?? null,
      session_expires_at: s?.expires_at ?? null,
    },
  });
}

export async function changePassword(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const email = (body?.email || "").trim().toLowerCase();
  const oldPassword = body?.old_password || "";
  const newPassword = body?.new_password || "";
  if (!email || !oldPassword || !newPassword)
    bad("Email, password lama, dan password baru wajib diisi");
  const user = await getUserByEmail(DB, email);
  if (!user || !user.password_hash || !(await verifyPassword(oldPassword, user.password_hash)))
    bad("Password lama salah", 401);
  if (newPassword.length < 8) bad("Password baru minimal 8 karakter");
  await updateUserPassword(DB, user.id, await hashPassword(newPassword));
  await insertLog(DB, "INFO", "Password '" + email + "' diubah", null, currentUserId(c));
  return c.json({ success: true });
}

export async function updateProfile(c: Context<AppEnv>) {
  const DB = getDb(c);
  const userId = currentUserId(c);
  const body = await c.req.json();
  const patch: {
    name?: string | null;
    phone?: string | null;
    email?: string;
  } = {};
  if (body?.name !== undefined) patch.name = String(body.name).trim() || null;
  if (body?.phone !== undefined) patch.phone = String(body.phone).trim() || null;
  if (body?.email !== undefined) {
    const current = await getUserById(DB, userId);
    const email = String(body.email).trim().toLowerCase();
    if (current?.google_sub && email !== current.email)
      bad("Email akun Google tidak bisa diubah");
    if (!isValidEmail(email)) bad("Email tidak valid");
    const dup = await getUserByEmail(DB, email);
    if (dup && dup.id !== userId) bad("Email sudah dipakai", 409);
    patch.email = email;
  }
  if (Object.keys(patch).length === 0)
    bad("Tidak ada field yang bisa diubah (name/phone/email)");
  await updateUser(DB, userId, patch);
  const u = await getUserById(DB, userId);
  await insertLog(DB, "INFO", "Profil diubah: " + (u?.email ?? userId));
  return c.json({
    success: true,
    data: {
      id: u?.id ?? null,
      email: u?.email ?? null,
      name: u?.name ?? null,
      phone: u?.phone ?? null,
      role: u?.role ?? "customer",
      status: u?.status ?? "active",
      created_at: u?.created_at ?? null,
      updated_at: u?.updated_at ?? null,
    },
  });
}
