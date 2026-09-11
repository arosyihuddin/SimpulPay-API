import { hashPassword } from "../../utils/auth.helper";
import {
  insertLog,
  getAdminSession,
} from "../../db/repositories";
import {
  listUsers,
  getUserById,
  getUserByEmail,
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
import { scheduleSubExpiry } from "../../durable_objects/subTimer";
import { MONTH_MS } from "../../services/pooling";
import type { Context } from "hono";
import type { AppEnv } from "../../types";
import { Db, getDb } from "../../db/client";
import { bad } from "./helpers";
import { isValidEmail } from "../../utils/auth.helper";

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
  const q = c.req.query("q") || undefined;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const users = await Promise.all(
    (await listUsers(DB, { limit, offset, q })).map(async (u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      updated_at: u.updated_at,
      ...(await userBillingInfo(DB, u.id)),
    })),
  );
  return c.json({
    success: true,
    data: { users, total: await countUsers(DB, q) },
  });
}

export async function createUserCtl(c: Context<AppEnv>) {
  const DB = getDb(c);
  const body = await c.req.json();
  const email = (body?.email || "").trim().toLowerCase();
  const password = body?.password || "";
  const role = (body?.role || "customer").trim();
  if (!isValidEmail(email)) bad("Email tidak valid");
  if (!["admin", "customer"].includes(role))
    bad("Role harus 'admin' atau 'customer'");
  if (!password ? role === "admin" : password.length < 8)
    bad("Password minimal 8 karakter");
  if (await getUserByEmail(DB, email)) bad("Email sudah dipakai", 409);
  const id = crypto.randomUUID();
  await createUser(DB, {
    id,
    email,
    passwordHash: password ? await hashPassword(password) : null,
    role: role as "admin" | "customer",
  });

  // Plan optional — bikin subscription + invoice pertama (kecuali free, sudah default)
  if (body?.plan_id && body.plan_id !== "p_free") {
    const plan = await getPlan(DB, body.plan_id);
    if (!plan) bad("Plan tidak ditemukan", 404);
    if (!plan.active) bad("Plan belum dipublish", 400);
    const subId = "sub_" + crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const endsAt = now + MONTH_MS;
    await createSubscription(DB, {
      id: subId,
      userId: id,
      planId: plan.id,
      startsAt: now,
      endsAt,
    });
    await scheduleSubExpiry(c.env, { subId, userId: id, endsAt });
    await createInvoice(DB, {
      id: "inv_" + crypto.randomUUID().slice(0, 8),
      userId: id,
      subscriptionId: subId,
      amount: plan.price,
      periodStart: now,
      periodEnd: endsAt,
    });
  }

  await insertLog(
    DB,
    "INFO",
    "User dibuat: " +
      email +
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
    email?: string;
    role?: "admin" | "customer";
    passwordHash?: string;
    status?: "active" | "suspended" | "banned";
  } = {};
  if (body?.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!isValidEmail(email)) bad("Email tidak valid");
    const dup = await getUserByEmail(DB, email);
    if (dup && dup.id !== id) bad("Email sudah dipakai", 409);
    patch.email = email;
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
  await insertLog(DB, "INFO", "User diubah: " + existing.email);
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
  await insertLog(DB, "INFO", "User dihapus: " + existing.email);
  return c.json({ success: true });
}
