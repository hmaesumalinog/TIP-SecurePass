import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { clientIp, HttpError, otpDigest, safeEqual, sha256 } from './http.mjs';
import { rpc } from './supabase.mjs';
import { clearSessionCookie, readSession } from './session.mjs';
import { sendEmail, securityNoticeEmail } from './resend.mjs';
import { codePepper, encryptionSecret } from './keys.mjs';

export { rpc };

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
export function totp(secret, step, digits = 6) {
  let bits = 0, value = 0; const bytes = [];
  for (const c of secret) {
    const n = alphabet.indexOf(c); if (n < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
// v2 secrets use RECOVERY_ENCRYPTION_KEY. v1 (derived from APP_PEPPER) is read
// only, so secrets created before the keys were separated still decrypt.
const keys = {
  v1: () => Buffer.from(hkdfSync('sha256', codePepper(), 'TIP SecurePass', 'recovery-encryption-v1', 32)),
  v2: () => Buffer.from(hkdfSync('sha256', encryptionSecret(), 'TIP SecurePass', 'recovery-encryption-v2', 32))
};
export function encryptSecret(secret, studentId) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keys.v2(), iv);
  cipher.setAAD(Buffer.from(studentId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v2', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptSecret(value, studentId) {
  const [version, iv, encrypted, tag] = value.split('.');
  if (!Object.hasOwn(keys, version)) throw new Error('Unsupported recovery secret');
  const cipher = createDecipheriv('aes-256-gcm', keys[version](), Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from(studentId)); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8');
}
export function matchingStep(encrypted, sid, code, now = Date.now()) {
  if (!encrypted || !/^\d{6}$/.test(String(code))) return -1;
  const secret = decryptSecret(encrypted, sid); const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) if (safeEqual(totp(secret, candidate), code)) return candidate;
  return -1;
}
export function recoveryCodes() { return Array.from({length:10}, () => randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-')); }
export function codeHash(code) { return otpDigest(`backup:${String(code || '').replace(/[\s-]/g, '').toUpperCase()}`); }

export const LIMITED = 'Too many requests. Please try again in an hour.';
// The same hourly IP and account limits as before, checked in one round trip.
export function rateKeys(request, context, identifier, limit = 10) {
  return [{key:sha256(`recovery-ip:${clientIp(request, context)}`),limit:40},{key:sha256(`recovery:${identifier}`),limit}];
}
export async function rate(request, context, identifier, limit = 10) {
  if (!await rpc('recovery_rate_many', {p_keys:rateKeys(request, context, identifier, limit)})) throw new HttpError(429, LIMITED);
}

// Validates the signed cookie and, in one database call, the account, password
// version, session version, optional rate limits, and recovery summary.
export async function currentStudent(request, { rate: limits = null, limitedMessage = LIMITED,
  setupMessage = 'Please sign in and complete password setup first.' } = {}) {
  const session = readSession(request);
  const signedOut = { 'Set-Cookie': clearSessionCookie() };
  if (!session) throw new HttpError(401, 'Your session expired. Please sign in again.', signedOut);
  if (session.mode === 'setup') throw new HttpError(401, setupMessage);
  const result = await rpc('student_context', { p_sid: session.sid, p_version: session.pv, p_session: session.sv,
    p_rate: typeof limits === 'function' ? limits(session) : limits });
  if (result?.status === 'limited') throw new HttpError(429, limitedMessage);
  if (result?.status !== 'ok') throw new HttpError(401, 'Your session expired. Please sign in again.', signedOut);
  return { student: result.student, recovery: result.recovery, session };
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  // The configured site address, or the address that served this request.
  const allowed = new Set([new URL(request.url).origin]);
  if (process.env.SITE_URL) allowed.add(new URL(process.env.SITE_URL).origin);
  if (origin && !allowed.has(origin)) throw new HttpError(403,'Request origin is not permitted.');
}
export async function securityNotice(email, event, id) {
  try {
    const result = await sendEmail({to:email,...securityNoticeEmail({event}),idempotencyKey:`recovery-${id}`});
    return !result.skipped;
  } catch { console.error('Recovery security notification could not be delivered.'); return false; }
}
