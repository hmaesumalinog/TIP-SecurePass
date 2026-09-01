import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      ...extraHeaders
    }
  });
}

export function assertPost(request) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, 'This endpoint accepts JSON requests only.');
  }
}

export async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 10_000) throw new HttpError(413, 'Request is too large.');
  try { return await request.json(); }
  catch { throw new HttpError(400, 'The request could not be read.'); }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function handleError(error) {
  if (error instanceof HttpError) return json({ message: error.message }, error.status);
  console.error('SecurePass function error:', error instanceof Error ? error.message : 'Unknown error');
  return json({ message: 'The secure service is temporarily unavailable. Please try again.' }, 500);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function otpDigest(value) {
  const pepper = process.env.APP_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error('APP_PEPPER must contain at least 32 characters.');
  return createHmac('sha256', pepper).update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function randomOtp() {
  const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid school email address.');
  }
  return email;
}

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return 'your registered phone';
  return `+${digits.slice(0, 2)} ••• ••• ${digits.slice(-4)}`;
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12 || value.length > 128) return false;
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value) && !/20\d{2}[- ]?\d{4,}/.test(value);
}

export function expiresIn(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
