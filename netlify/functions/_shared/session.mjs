import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'tip_securepass_session';
const SESSION_SECONDS = 60 * 60 * 4;

function pepper() {
  const value = process.env.APP_PEPPER;
  if (!value || value.length < 32) throw new Error('APP_PEPPER must contain at least 32 characters.');
  return value;
}

function signature(payload) {
  return createHmac('sha256', pepper()).update(payload).digest('base64url');
}

export function createSession(student, { setupOnly = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const lifetime = setupOnly ? 10 * 60 : SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({
    sid: student.id,
    pv: student.password_changed_at || '',
    mode: setupOnly ? 'setup' : 'portal',
    iat: now,
    exp: now + lifetime
  })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function readSession(request) {
  const cookies = request.headers.get('cookie') || '';
  const pair = cookies.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!pair) return null;
  const token = pair.slice(COOKIE_NAME.length + 1);
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return null;

  const expected = Buffer.from(signature(payload));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.sid || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch { return null; }
}

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
