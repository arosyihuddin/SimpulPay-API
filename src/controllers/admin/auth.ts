import { ADMIN_TTL_MS } from "../../middleware/guards";
import { hashPassword } from "../../utils/auth.helper";
import {
  insertLog,
  createAdminSession,
  getAdminSession,
  createMerchant,
} from "../../db/repositories";
import {
  listUsers,
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  deleteUser,
  countUsers,
} from "../../db/repositories/user.repository";
import {
  getActiveSubscription,
  getPlan,
  listInvoices,
  createSubscription,
  createInvoice,
} from "../../db/repositories";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { Db, getDb } from "../../db/client";
import { bad, cookieHeader, SESSION_MAX_AGE } from "./helpers";

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
  await createMerchant(DB, {
    id: "m_" + id.slice(0, 8),
    userId: id,
    name: "Merchant " + username,
  });
  const token = crypto.randomUUID();
  await createAdminSession(DB, token, ADMIN_TTL_MS, id);
  await insertLog(
    DB,
    "INFO",
    "Setup selesai: admin '" + username + "' dibuat. Login sukses.",
  );
  c.header("Set-Cookie", cookieHeader(token, SESSION_MAX_AGE));
  return c.json({ success: true });
}

async function userBillingInfo(DB: Db, userId: string) {
  const sub = await getActiveSubscription(DB, userId);
  if (!sub) return { plan: null, subscription: null, latest_invoice: null };
  const plan = await getPlan(DB, sub.plan_id);
  const invs = await listInvoices(DB, { userId, limit: 1 });
  const inv = invs[0] ?? null;
  const pick = (r: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, r[k]]));
  return {
    plan: plan
      ? pick(plan, [
          "id",
          "name",
          "type",
          "price",
          "max_merchants",
          "daily_paid_limit",
        ])
      : null,
    subscription: pick(sub, [
      "id",
      "plan_id",
      "status",
      "starts_at",
      "ends_at",
    ]),
    latest_invoice: inv
      ? pick(inv, [
          "id",
          "amount",
          "status",
          "period_start",
          "period_end",
          "created_at",
        ])
      : null,
  };
}

export async function listUsersCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const q = c.req.query();
  const limit = parseInt((q.limit as string) || "50", 10);
  const offset = parseInt((q.offset as string) || "0", 10);
  const users = await Promise.all(
    (await listUsers(DB, limit, offset)).map(async (u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      updated_at: u.updated_at,
      ...(await userBillingInfo(DB, u.id)),
    })),
  );
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
  const role = (body?.role || "customer").trim();
  if (username.length < 3) bad("Username minimal 3 karakter");
  if (password.length < 8) bad("Password minimal 8 karakter");
  if (await getUserByUsername(DB, username)) bad("Username sudah dipakai", 409);
  if (!["admin", "customer"].includes(role))
    bad("Role harus 'admin' atau 'customer'");
  const id = crypto.randomUUID();
  await createUser(DB, {
    id,
    username,
    passwordHash: await hashPassword(password),
    role: role as "admin" | "customer",
  });

  // Plan optional — bikin subscription + invoice pertama
  if (body?.plan_id) {
    const plan = await getPlan(DB, body.plan_id);
    if (!plan) bad("Plan tidak ditemukan", 404);
    const subId = "sub_" + crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    await createSubscription(DB, {
      id: subId,
      userId: id,
      planId: plan.id,
      startsAt: now,
      endsAt: now + monthMs,
    });
    await createInvoice(DB, {
      id: "inv_" + crypto.randomUUID().slice(0, 8),
      userId: id,
      subscriptionId: subId,
      amount: plan.price,
      periodStart: now,
      periodEnd: now + monthMs,
    });
  }

  await insertLog(
    DB,
    "INFO",
    "User dibuat: " +
      username +
      " (" +
      role +
      ")" +
      (body?.plan_id ? " +plan" : ""),
  );
  return c.json({ success: true, data: { id } });
}

export async function updateUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const existing = await getUserById(DB, id);
  if (!existing) bad("User tidak ditemukan", 404);
  const body = await c.req.json();
  const patch: {
    username?: string;
    role?: "admin" | "customer";
    passwordHash?: string;
    status?: "active" | "suspended" | "banned";
  } = {};
  if (body?.username !== undefined) {
    const username = String(body.username).trim();
    if (username.length < 3) bad("Username minimal 3 karakter");
    const dup = await getUserByUsername(DB, username);
    if (dup && dup.id !== id) bad("Username sudah dipakai", 409);
    patch.username = username;
  }
  if (body?.role !== undefined) {
    const role = String(body.role).trim();
    if (!["admin", "customer"].includes(role))
      bad("Role harus 'admin' atau 'customer'");
    patch.role = role as "admin" | "customer";
  }
  if (body?.status !== undefined) {
    const status = String(body.status).trim();
    if (!["active", "suspended", "banned"].includes(status))
      bad("Status harus active/suspended/banned");
    patch.status = status as "active" | "suspended" | "banned";
  }
  if (body?.password) {
    if (String(body.password).length < 8) bad("Password minimal 8 karakter");
    patch.passwordHash = await hashPassword(String(body.password));
  }
  await updateUser(DB, id, patch);
  await insertLog(DB, "INFO", "User diubah: " + existing.username);
  return c.json({ success: true });
}

export async function deleteUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const id = c.req.param("id") ?? "";
  const existing = await getUserById(DB, id);
  if (!existing) bad("User tidak ditemukan", 404);
  const s = await getAdminSession(DB, c.get("adminToken") as string);
  if (s?.user_id === id)
    bad("Tidak bisa menghapus akun yang sedang dipakai", 409);
  await deleteUser(DB, id);
  await insertLog(DB, "INFO", "User dihapus: " + existing.username);
  return c.json({ success: true });
}
