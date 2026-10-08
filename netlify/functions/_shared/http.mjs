import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { codePepper } from './keys.mjs';

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
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
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'The request could not be read.');
  }
}

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

export function handleError(error) {
  if (error instanceof HttpError) return json({ message: error.message }, error.status, error.headers);
  console.error('SecurePass function error:', error instanceof Error ? error.message : 'Unknown error');
  return json(
    {
      message: 'The secure service is temporarily unavailable. Please try again.'
    },
    500
  );
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function otpDigest(value) {
  return createHmac('sha256', codePepper()).update(value).digest('hex');
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function randomOtp() {
  const value = randomInt(0, 1_000_000);
  return String(value).padStart(6, '0');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
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

export function validatePassword(password, studentNumber = '') {
  const value = String(password || '');
  const identifier = String(studentNumber || '').trim();
  if (!passwordShapeValid(value)) return false;
  const excludesStudentNumber = /^\d{7}$/.test(identifier) ? !value.includes(identifier) : !/\d{7}/.test(value);
  return excludesStudentNumber;
}

// Length and character classes only. The database adds the student-number rule
// when the server does not hold the number itself.
export function passwordShapeValid(password) {
  const value = String(password || '');
  return value.length >= 12 && value.length <= 128 && /[A-Z]/.test(value) && /[a-z]/.test(value)
    && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

export function expiresIn(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function clientIp(request, context) {
  return context?.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
}

export function siteOrigin(request) {
  return (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
}

// Simulated delivery is for a developer's own machine only, never a deployment.
export function isLocalRequest(request) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}

// Lets slow follow-up work (email, SMS) finish after the response is sent, so
// its duration cannot reveal anything. Without a platform context (tests and
// local scripts) the work completes before returning.
export async function afterResponse(context, task, failureMessage) {
  const work = Promise.resolve()
    .then(task)
    .catch(() => console.error(failureMessage));
  if (typeof context?.waitUntil === 'function') context.waitUntil(work);
  else await work;
}
