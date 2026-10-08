import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';
import { rpc } from './supabase.mjs';
import { sessionSecret } from './keys.mjs';

const COOKIE_NAME = 'tip_securepass_admin';
const SESSION_SECONDS = 30 * 60;
const EXPIRED = 'Your administrator session has expired.';

function sign(payload) { return createHmac('sha256', sessionSecret()).update(`admin:${payload}`).digest('base64url'); }

export function createAdminSession(admin) {
  const now = Math.floor(Date.now() / 1000);
  const csrf = randomBytes(24).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aid: admin.id, pv: admin.password_changed_at, sv: Number(admin.session_version ?? 0), role: admin.role,
    csrf, iat: now, exp: now + SESSION_SECONDS
  })).toString('base64url');
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
    return session.aid && Number.isInteger(session.sv) && session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch { return null; }
}

function expired() { return new HttpError(401, EXPIRED, { 'Set-Cookie': clearAdminCookie() }); }

const identity = (admin) => ({ displayName: admin.display_name, email: admin.email, role: admin.role });

// For changes: one round trip confirms the account is active, the password and
// session versions still match, and the role is allowed.
export async function requireAdmin(request, roles = ['super_admin', 'viewer']) {
  const session = readAdminSession(request);
  if (!session) throw expired();
  const admin = await rpc('admin_context', { p_admin: session.aid, p_version: session.pv, p_session: session.sv });
  if (!admin?.id) throw expired();
  if (!roles.includes(admin.role)) throw new HttpError(403, 'Administrator access is not permitted.');
  return { admin, session };
}

// For reads: the session check and the requested view share one round trip.
export async function adminRead(request, view, args = {}, missingMessage = 'Record not found.') {
  const session = readAdminSession(request);
  if (!session) throw expired();
  const result = await rpc('admin_read', { p_admin: session.aid, p_version: session.pv, p_session: session.sv, p_view: view, p_args: args });
  if (result?.status === 'unauthorized') throw expired();
  if (result?.status === 'forbidden') throw new HttpError(403, 'Recovery reviews are available to super administrators only.');
  if (result?.status === 'missing') throw new HttpError(404, missingMessage);
  if (result?.status !== 'ok') throw new Error('Administrator view could not be loaded.');
  return {
    admin: identity(result.admin),
    csrfToken: session.csrf,
    changeToken: result.token,
    refreshedAt: new Date().toISOString(),
    data: result.data
  };
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
