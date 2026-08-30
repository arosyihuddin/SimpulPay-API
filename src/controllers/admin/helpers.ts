import { ADMIN_TTL_MS } from "../../middleware/guards";
import type { Context } from "hono";
import type { AppEnv } from "../../types";

export const SESSION_MAX_AGE = ADMIN_TTL_MS / 1000;

export function bad(message: string, status = 400): never {
  const err: any = new Error(message);
  err.status = status;
  throw err;
}

export function cookieHeader(token: string, maxAge: number): string {
  const sameSite = "None";
  const secure = "; Secure";
  return `${"gopay_admin_session"}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}

export function paramId(c: Context<AppEnv>): string {
  const id = c.req.param("id");
  if (!id) bad("id wajib ada", 400);
  return id;
}
