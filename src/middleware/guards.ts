// Guard API key (publik) & sesi admin (cookie httpOnly)
import { getAdminSession, cleanExpiredSessions } from '../db/queries';
import { getSetting } from '../db/queries';

export const ADMIN_COOKIE = 'gopay_admin_session';
export const ADMIN_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

// Ambil API key dari header X-Api-Key / Authorization Bearer, atau query api_key/apikey
export function extractApiKey(ctx: { headers: Record<string, string | undefined>; query: Record<string, unknown> }): string | null {
  const auth = ctx.headers['authorization'];
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return (
    ctx.headers['x-api-key'] ??
    (first(ctx.query.api_key) as string) ??
    (first(ctx.query.apikey) as string) ??
    null
  );
}

export async function getApiKey(): Promise<string> {
  return (await getSetting('api_key')) || '';
}
export async function apiKeyOk(key: string | null): Promise<boolean> {
  const expected = await getApiKey();
  return !!expected && key === expected;
}

// true bila token admin valid & belum kedaluwarsa
export async function adminOk(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  await cleanExpiredSessions();
  const s = await getAdminSession(token);
  return !!s && s.expires_at > Date.now();
}
