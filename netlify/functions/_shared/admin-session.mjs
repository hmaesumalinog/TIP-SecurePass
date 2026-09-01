import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';
import { query, supabase } from './supabase.mjs';

const COOKIE_NAME = 'tip_securepass_admin';
const SESSION_SECONDS = 30 * 60;

function pepper() {
  const value = process.env.APP_PEPPER;
  if (!value || value.length < 32) throw new Error('APP_PEPPER must contain at least 32 characters.');
  return value;
}

function sign(payload) { return createHmac('sha256', pepper()).update(`admin:${payload}`).digest('base64url'); }

export function createAdminSession(admin) {
  const now = Math.floor(Date.now() / 1000);
  const csrf = randomBytes(24).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aid: admin.id, pv: admin.password_changed_at, role: admin.role, csrf, iat: now, exp: now + SESSION_SECONDS })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, csrf };
}

export function readAdminSession(request) {
  const pair = (request.headers.get('cookie') || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return null;
  const [payload, suppliedSignature] = pair.slice(COOKIE_NAME.length + 1).split('.');
  if (!payload || !suppliedSignature) return null;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.aid && session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch { return null; }
}

export async function requireAdmin(request, roles = ['super_admin', 'viewer']) {
  const session = readAdminSession(request);
  if (!session) throw new HttpError(401, 'Your administrator session has expired.');
  const rows = await supabase(`admin_accounts?${query({ select: 'id,email,display_name,role,active,password_changed_at', id: `eq.${session.aid}`, active: 'eq.true', limit: 1 })}`);
  const admin = rows[0];
  if (!admin || admin.password_changed_at !== session.pv || !roles.includes(admin.role)) throw new HttpError(403, 'Administrator access is not permitted.');
  return { admin, session };
}

export function requireCsrf(request, session) {
  const supplied = request.headers.get('x-admin-csrf') || '';
  const expected = String(session.csrf || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'The administrator request could not be verified.');
}

export function adminCookie(token) { return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`; }
export function clearAdminCookie() { return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`; }
