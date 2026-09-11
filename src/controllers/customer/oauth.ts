import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { ADMIN_TTL_MS } from "../../middleware/guards";
import { getDb } from "../../db/client";
import type { AppEnv } from "../../types";
import {
  createAdminSession,
  insertLog,
} from "../../db/repositories";
import {
  createUser,
  getUserByEmail,
  getUserByGoogleSub,
  getUserById,
  updateUser,
} from "../../db/repositories/user.repository";
import { bad, cookieHeader, SESSION_MAX_AGE } from "./helpers";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const STATE_COOKIE = "oauth_state";
const STATE_TTL = 600;

interface GoogleOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

function failRedirect(c: Context<AppEnv>, reason = "login_gagal") {
  const base = (c.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  return c.redirect(`${base}/login?oauth_error=${reason}`, 302);
}

function oauthEnv(c: Context<AppEnv>): GoogleOAuthEnv {
  const clientId = c.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = c.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) bad("Login Google belum dikonfigurasi", 500);
  return { clientId, clientSecret, redirectUri };
}

export async function googleStart(c: Context<AppEnv>) {
  const { clientId, redirectUri } = oauthEnv(c);
  const state = crypto.randomUUID().replace(/-/g, "");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  c.header(
    "Set-Cookie",
    `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL}`,
  );
  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
}

async function exchangeCode(code: string, env: GoogleOAuthEnv): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      redirect_uri: env.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!res.ok) throw new Error("token_exchange_failed");
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("token_exchange_failed");
  return data.access_token;
}

async function fetchGoogleUser(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("userinfo_failed");
  const data = (await res.json()) as GoogleUserInfo;
  if (!data.sub || !data.email || data.email_verified !== true)
    throw new Error("email_unverified");
  return data;
}

export async function googleCallback(c: Context<AppEnv>) {
  const DB = getDb(c);
  let env: GoogleOAuthEnv;
  try {
    env = oauthEnv(c);
  } catch {
    return failRedirect(c);
  }

  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  const expected = getCookie(c, STATE_COOKIE);
  c.header("Set-Cookie", `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  if (!code || !state || !expected || state !== expected)
    return failRedirect(c);

  let info: GoogleUserInfo;
  try {
    const accessToken = await exchangeCode(code, env);
    info = await fetchGoogleUser(accessToken);
  } catch {
    await insertLog(DB, "WARNING", "Login Google gagal (token/userinfo)");
    return failRedirect(c);
  }

  const email = info.email.trim().toLowerCase();
  const displayName = info.name?.trim() || null;
  try {
    let user = await getUserByGoogleSub(DB, info.sub);
    if (!user) {
      const byEmail = await getUserByEmail(DB, email);
      if (byEmail) {
        if (byEmail.role !== "customer" || byEmail.status !== "active")
          return failRedirect(c);
        if (byEmail.google_sub && byEmail.google_sub !== info.sub)
          return failRedirect(c);
        if (!byEmail.google_sub) {
          await updateUser(DB, byEmail.id, {
            googleSub: info.sub,
            ...(byEmail.name ? {} : { name: displayName }),
          });
        }
        user = await getUserByEmail(DB, email);
      } else {
        const id = crypto.randomUUID();
        await createUser(DB, {
          id,
          email,
          passwordHash: null,
          googleSub: info.sub,
          name: displayName,
          role: "customer",
          status: "active",
        });
        user = await getUserById(DB, id);
      }
    }
    if (!user || user.role !== "customer" || user.status !== "active")
      return failRedirect(c);

    const token = crypto.randomUUID();
    await createAdminSession(DB, token, ADMIN_TTL_MS, user.id);
    await insertLog(DB, "INFO", "Login Google sukses: " + email, null, user.id);
    c.header("Set-Cookie", cookieHeader(token, SESSION_MAX_AGE));
    const base = (c.env.FRONTEND_URL ?? "").replace(/\/$/, "");
    return c.redirect(base ? `${base}/dashboard` : "/dashboard", 302);
  } catch {
    return failRedirect(c);
  }
}
