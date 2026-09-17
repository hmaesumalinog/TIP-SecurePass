import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { HttpError, otpDigest, safeEqual, sha256 } from './http.mjs';
import { supabase, query } from './supabase.mjs';
import { readSession } from './session.mjs';
import { sendEmail } from './resend.mjs';

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
function encryptionKey() {
  const pepper = process.env.APP_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('Recovery encryption is not configured');
  return Buffer.from(hkdfSync('sha256', pepper, 'TIP SecurePass', 'recovery-encryption-v1', 32));
}
export function encryptSecret(secret, studentId) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(studentId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), encrypted.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptSecret(value, studentId) {
  const [version, iv, encrypted, tag] = value.split('.');
  if (version !== 'v1') throw new Error('Unsupported recovery secret');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
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
export async function rpc(name, data) { return supabase(`rpc/${name}`, {method:'POST',body:JSON.stringify(data)}); }
export async function rate(request, identifier, limit = 10) {
  const ip = request.headers.get('x-nf-client-connection-ip') || 'unknown';
  const ipAllowed = await rpc('recovery_rate', {p_key:sha256(`recovery-ip:${ip}`),p_limit:40});
  if (!ipAllowed) throw new HttpError(429, 'Too many requests. Please try again in an hour.');
  const accountAllowed = await rpc('recovery_rate', {p_key:sha256(`recovery:${identifier}`),p_limit:limit});
  if (!ipAllowed || !accountAllowed) throw new HttpError(429, 'Too many requests. Please try again in an hour.');
}
export async function currentStudent(request) {
  const session = readSession(request);
  if (!session || session.mode === 'setup') throw new HttpError(401,'Please sign in and complete password setup first.');
  const rows = await supabase(`demo_students?${query({select:'id,email,phone,password_changed_at',id:`eq.${session.sid}`,active:'eq.true',limit:1})}`);
  const student = rows[0];
  if (!student || (student.password_changed_at || '') !== session.pv) throw new HttpError(401,'Your session expired. Please sign in again.');
  return {student,session};
}
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(process.env.SITE_URL || request.url).origin) throw new HttpError(403,'Request origin is not permitted.');
}
export async function securityNotice(email, event, id) {
  try {
    const text = `A security change (${event}) was completed for your Reset Workflow academic demonstration account at resetworkflow.site. This is not the official TIP portal. If this was not you, contact the demonstration administrator immediately. No recovery codes are included in this notice.`;
    await sendEmail({to:email,subject:'Reset Workflow: account security notice',text,html:`<p>${text}</p>`,idempotencyKey:`recovery-${id}`});
    return true;
  } catch { console.error('Recovery security notification could not be delivered.'); return false; }
}
