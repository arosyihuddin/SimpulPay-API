import { saveGoBizSession, loadGoBizSession } from '../db/repositories';
import type { Db } from '../db/client';

const GOBIZ_TOKEN_URL = 'https://api.gobiz.co.id/goid/token';

const ACCESS_TTL_MS = 24 * 3600 * 1000;

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

export interface Session {
  phone_number?: string | null;
  merchant_id?: string | null;
  outlet_name?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  cookie?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
  [key: string]: unknown;
}

export function goBizHeaders(uniqueId?: string) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'accept-language': 'id',
    'authentication-type': 'go-id',
    'gojek-country-code': 'ID',
    'gojek-timezone': 'Asia/Jakarta',
    origin: 'https://portal.gofoodmerchant.co.id',
    referer: 'https://portal.gofoodmerchant.co.id/',
    'user-agent': UA,
    'x-appid': 'go-biz-web-dashboard',
    'x-appversion': 'platform-v3.111.0-1708bc9a',
    'x-deviceos': 'Web',
    'x-phonemake': 'Windows 10 64-bit',
    'x-phonemodel': 'Chrome 150.0.0.0 on Windows 10 64-bit',
    'x-platform': 'Web',
    'x-uniqueid': uniqueId ?? crypto.randomUUID(),
    'x-user-locale': 'en-GB',
    'x-user-type': 'merchant',
  };
}

export function buildSession(input: {
  access_token: string;
  refresh_token: string;
  phone_number?: string | null;
  merchant_id?: string | null;
  outlet_name?: string | null;
  extra?: Session;
}): Session {
  const updatedAt = new Date();
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  return {
    ...(input.extra ?? {}),
    phone_number: input.phone_number ?? input.extra?.phone_number ?? null,
    merchant_id: input.merchant_id ?? input.extra?.merchant_id ?? null,
    outlet_name: input.outlet_name ?? input.extra?.outlet_name ?? null,
    access_token: input.access_token,
    refresh_token: input.refresh_token,
    cookie: `access_token=${input.access_token}; refresh_token=${input.refresh_token}; auth_method=goid`,
    updated_at: updatedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

export async function saveSession(DB: Db, merchantId: string, session: Session): Promise<void> {
  const data = {
    phone_number: session.phone_number ?? null,
    merchant_id: session.merchant_id ?? null,
    outlet_name: session.outlet_name ?? null,
    access_token: session.access_token ?? null,
    refresh_token: session.refresh_token ?? null,
    cookie: session.cookie ?? null,
    updated_at: session.updated_at ?? null,
    expires_at: session.expires_at ?? null,
  };
  await saveGoBizSession(DB, merchantId, data as Record<string, unknown>);
  console.log('[SessionManager] Sesi berhasil diperbarui dan disimpan ke database.');
}

export async function loadSession(DB: Db, merchantId: string): Promise<Session | null> {
  try {
    const data = await loadGoBizSession(DB, merchantId);
    return data as Session | null;
  } catch {
    return null;
  }
}

export function isExpired(session: Session | null | undefined): boolean {
  if (!session || !session.access_token) return true;
  if (!session.expires_at) return false;
  return new Date(session.expires_at).getTime() < Date.now();
}

export async function refreshSession(DB: Db, merchantId: string): Promise<Session | null> {
  const session = await loadSession(DB, merchantId);
  if (!session || !session.refresh_token) {
    console.log('[SessionManager] Refresh token tidak ditemukan. Diperlukan login ulang (Settings → Login GoBiz).');
    return null;
  }

  console.log('[SessionManager] Mengirimkan request auto-refresh token ke GoBiz...');
  try {
    const res = await fetch(GOBIZ_TOKEN_URL, {
      method: 'POST',
      headers: goBizHeaders(),
      body: JSON.stringify({
        client_id: 'go-biz-web-new',
        grant_type: 'refresh_token',
        data: { refresh_token: session.refresh_token, phone_number: '', country_code: '62' },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    const data = json?.data ?? json;

    if (!data?.access_token) {
      console.log(`[SessionManager] Auto-refresh token GAGAL: ${JSON.stringify(json)}`);
      return null;
    }

    const updated = buildSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? (session.refresh_token as string),
      extra: { ...session },
    });
    await saveSession(DB, merchantId, updated);
    console.log('[SessionManager] Auto-refresh token BERHASIL! Token baru telah ditulis ke database.');
    return updated;
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`[SessionManager] Auto-refresh token GAGAL: ${msg}`);
    return null;
  }
}

let lastMissingWarn = 0;
export async function getValidHeaders(DB: Db, merchantId: string, userAgent?: string): Promise<Record<string, string> | null> {
  let session = await loadSession(DB, merchantId);
  if (!session || !session.access_token) {
    const now = Date.now();
    if (now - lastMissingWarn > 60_000) {
      lastMissingWarn = now;
      console.log('[SessionManager] PERINGATAN: Sesi GoPay belum tersedia. Login OTP lewat dashboard (Settings → Login GoBiz).');
    }
    return null;
  }

  if (isExpired(session)) {
    console.log('[SessionManager] Token terdeteksi kadaluwarsa, mencoba refresh otomatis...');
    const refreshed = await refreshSession(DB, merchantId);
    if (refreshed) session = refreshed;
  }

  if (!session.access_token) return null;
  const cookie =
    session.cookie ??
    `access_token=${session.access_token}; refresh_token=${session.refresh_token ?? ''}; auth_method=goid`;

  return {
    Authorization: `Bearer ${session.access_token}`,
    Cookie: cookie,
    'authentication-type': 'go-id',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://portal.gofoodmerchant.co.id',
    Referer: 'https://portal.gofoodmerchant.co.id/',
    'User-Agent': userAgent || UA,
  };
}