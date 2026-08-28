import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { ADMIN_COOKIE } from "../middleware/guards";

const SALT = 16;
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function cookieToken(ctx: any): string | null {
  const raw = ctx.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === ADMIN_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
