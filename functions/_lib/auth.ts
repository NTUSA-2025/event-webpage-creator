import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import type { Env, RoleState, SessionUser } from './types';
import { HttpError } from './http';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();
let directoryToken: { value: string; expires: number } | undefined;

function base64url(bytes: Uint8Array): string {
  let text = '';
  bytes.forEach((byte) => { text += String.fromCharCode(byte); });
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secret(env: Env): Uint8Array {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'SESSION_SECRET 尚未設定');
  return encoder.encode(env.SESSION_SECRET);
}

export function cookie(name: string, value: string, env: Env, maxAge: number): string {
  const secure = env.PUBLIC_ORIGIN.startsWith('https:') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function readCookie(request: Request, name: string): string | undefined {
  const pair = request.headers.get('Cookie')?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}

export async function startGoogle(env: Env, requestedReturn: string): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(503, 'Google OAuth 尚未設定');
  const state = crypto.randomUUID();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const returnTo = /^\/#\/(dashboard|edit\/[a-f0-9-]+|view\/[A-Za-z0-9_-]+)$/.test(requestedReturn)
    ? requestedReturn : '/#/dashboard';
  const pending = await new SignJWT({ state, returnTo, verifier })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(secret(env));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${env.PUBLIC_ORIGIN}/api/auth/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': cookie('oauth_pending', pending, env, 600), 'Cache-Control': 'no-store' } });
}

export async function finishGoogle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pending = readCookie(request, 'oauth_pending');
  if (!pending || !url.searchParams.get('code')) throw new HttpError(400, '登入流程已失效');
  let state = '', returnTo = '/#/dashboard', verifier = '';
  try {
    const { payload } = await jwtVerify(pending, secret(env));
    state = String(payload.state || '');
    returnTo = String(payload.returnTo || returnTo);
    verifier = String(payload.verifier || '');
  } catch { throw new HttpError(400, '登入流程已失效'); }
  if (state !== url.searchParams.get('state') || !verifier) throw new HttpError(400, '登入驗證失敗');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${env.PUBLIC_ORIGIN}/api/auth/callback`, grant_type: 'authorization_code', code_verifier: verifier }),
  });
  if (!tokenResponse.ok) throw new HttpError(401, 'Google 登入失敗');
  const token = await tokenResponse.json() as { id_token?: string };
  if (!token.id_token) throw new HttpError(401, 'Google 未提供身分資訊');
  const { payload } = await jwtVerify(token.id_token, googleKeys, { audience: env.GOOGLE_CLIENT_ID, issuer: ['https://accounts.google.com', 'accounts.google.com'] });
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw new HttpError(401, 'Google 信箱未驗證');
  const user: SessionUser = { sub: payload.sub, email: String(payload.email).toLowerCase(), name: String(payload.name || payload.email), picture: typeof payload.picture === 'string' ? payload.picture : undefined };
  const session = await new SignJWT(user as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('12h').sign(secret(env));
  const headers = new Headers({ Location: `${env.PUBLIC_ORIGIN}${returnTo}`, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie('session', session, env, 43200));
  headers.append('Set-Cookie', cookie('oauth_pending', '', env, 0));
  return new Response(null, { status: 302, headers });
}

export async function sessionUser(request: Request, env: Env): Promise<SessionUser | null> {
  const session = readCookie(request, 'session');
  if (!session) return null;
  try {
    const { payload } = await jwtVerify(session, secret(env));
    if (!payload.sub || !payload.email) return null;
    return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: String(payload.name || payload.email), picture: typeof payload.picture === 'string' ? payload.picture : undefined };
  } catch { return null; }
}

async function getDirectoryToken(env: Env): Promise<string> {
  if (directoryToken && directoryToken.expires > Date.now() + 60_000) return directoryToken.value;
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.GOOGLE_WORKSPACE_ADMIN_EMAIL) {
    throw new HttpError(503, 'Google Groups 驗證尚未設定');
  }
  const key = await importPKCS8(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/admin.directory.group.member.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(env.GOOGLE_SERVICE_ACCOUNT_EMAIL).setSubject(env.GOOGLE_WORKSPACE_ADMIN_EMAIL)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new HttpError(503, 'Google Groups 驗證暫時不可用');
  const value = await response.json() as { access_token: string; expires_in: number };
  directoryToken = { value: value.access_token, expires: Date.now() + value.expires_in * 1000 };
  return value.access_token;
}

export async function inGroup(env: Env, group: string, email: string): Promise<boolean> {
  if (!group) return false;
  const token = await getDirectoryToken(env);
  const url = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(group)}/hasMember/${encodeURIComponent(email)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return false;
  if (!response.ok) throw new HttpError(503, 'Google Groups 驗證暫時不可用');
  const value = await response.json() as { isMember?: boolean };
  return value.isMember === true;
}

export async function roles(user: SessionUser, env: Env): Promise<RoleState> {
  const rules = await env.DB.prepare('SELECT kind, value FROM creator_rules').all<{ kind: string; value: string }>();
  const email = user.email.toLowerCase();
  const domain = email.split('@')[1];
  const matching = (rules.results || []).some((r) => (r.kind === 'email' && r.value === email) || (r.kind === 'domain' && r.value === domain));
  const groups = new Set([env.ADMIN_GROUP_EMAIL, env.ENGINEER_GROUP_EMAIL, ...(rules.results || []).filter((r) => r.kind === 'group').map((r) => r.value)].filter(Boolean));
  const membership = new Map<string, boolean>();
  await Promise.all([...groups].map(async (group) => membership.set(group, await inGroup(env, group, email))));
  const isAdmin = !!membership.get(env.ADMIN_GROUP_EMAIL);
  const isEngineer = !!membership.get(env.ENGINEER_GROUP_EMAIL);
  const canCreate = isAdmin || matching || (rules.results || []).some((r) => r.kind === 'group' && membership.get(r.value));
  return { ...user, isAdmin, isEngineer, canCreate };
}

export async function requireUser(request: Request, env: Env): Promise<RoleState> {
  const user = await sessionUser(request, env);
  if (!user) throw new HttpError(401, '請先登入 Google');
  return roles(user, env);
}

export function requireCreator(user: RoleState): void {
  if (!user.canCreate) throw new HttpError(403, '此帳號尚未獲得建立資格');
}

export function requireAdmin(user: RoleState): void {
  if (!user.isAdmin) throw new HttpError(403, '需要管理員權限');
}

export function requireEngineer(user: RoleState): void {
  if (!user.isEngineer) throw new HttpError(403, '需要工程師群組權限');
}
