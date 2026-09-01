import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { ADMIN_COOKIE } from "../middleware/guards";

const SALT_LEN = 16;
const ITERATIONS = 100_000;
const KEY_LEN_BITS = 512;

function bufToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LEN_BITS,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await deriveKey(password, salt);
  return `${bufToHex(salt.buffer)}:${bufToHex(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const candidate = await deriveKey(password, hexToUint8(saltHex));
  const expected = hexToUint8(hashHex);
  const cand = new Uint8Array(candidate);
  if (cand.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < cand.length; i++) diff |= cand[i] ^ expected[i];
  return diff === 0;
}

export function cookieToken(c: Context): string | null {
  const raw = getCookie(c, ADMIN_COOKIE);
  return raw ? decodeURIComponent(raw) : null;
}

// cek email format minimal — cari @ + domain
export function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
