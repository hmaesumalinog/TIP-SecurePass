const DEFAULT_BASE_URL = 'https://unismsapi.com/api';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function baseUrl() {
  const value = String(process.env.UNISMS_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/$/, '');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('UNISMS_BASE_URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'unismsapi.com' || !/^\/api(?:\/|$)/.test(parsed.pathname)) {
    throw new Error('UNISMS_BASE_URL is invalid.');
  }
  return value;
}

export function normalizeUniSmsPhone(value) {
  let digits = String(value || '').trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `63${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) throw new Error('The registered phone number is invalid.');
  return `+${digits}`;
}

function allowedPhones() {
  return String(process.env.UNISMS_ALLOWED_PHONE || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeUniSmsPhone);
}

export function canUseUniSmsForPhone(phone) {
  if (String(process.env.SMS_PROVIDER || '').toLowerCase() !== 'unisms') return false;
  if (!String(process.env.UNISMS_API_KEY || '').trim() || !String(process.env.UNISMS_SENDER_ID || '').trim()) return false;
  if (String(process.env.UNISMS_TRIAL_MODE || '').toLowerCase() !== 'true') return true;
  const allowed = allowedPhones();
  return allowed.length > 0 && allowed.includes(normalizeUniSmsPhone(phone));
}

async function unisms(path, body) {
  const apiKey = required('UNISMS_API_KEY');
  const credentials = Buffer.from(`${apiKey}:`, 'utf8').toString('base64');
  const response = await fetch(`${baseUrl()}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = data?.message?.fail_reason || data?.message?.error || data?.error || data?.message;
    throw new Error(typeof providerMessage === 'string' ? providerMessage : `UniSMS returned ${response.status}.`);
  }
  return data;
}

export function otpMessage(otp, purpose = 'password_reset') {
  if (!/^\d{6}$/.test(String(otp))) throw new Error('The SMS verification code must contain 6 digits.');
  const purposes = {
    password_reset: 'reset your password',
    phone_verification: 'verify your recovery phone number'
  };
  if (!Object.hasOwn(purposes, purpose)) throw new Error('Unsupported SMS verification purpose.');
  // Both database challenges expire after five minutes. Use plain GSM text and
  // include brand, OTP, purpose and expiry as required by provider filtering.
  return `Your Reset Workflow OTP code is ${otp}. Use it to ${purposes[purpose]}. Please do not share. Expires in 5 minutes.`;
}

function delivery(message) {
  const status = String(message?.status || '').toLowerCase();
  if (['failed', 'rejected', 'error'].includes(status)) return 'failed';
  if (status === 'sent') return 'sent';
  if (['pending', 'queued', 'retrying'].includes(status)) return 'pending';
  return 'unknown';
}

export async function getUniSmsStatus(referenceId) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(referenceId || '')) throw new Error('Invalid SMS reference.');
  const data = await unisms(`/sms/${encodeURIComponent(referenceId)}`);
  // Never forward the provider payload: it contains the recipient and OTP.
  return { status: delivery(data?.message || data) };
}

export async function sendUniSmsOtp(phone, otp, purpose = 'password_reset') {
  const recipient = normalizeUniSmsPhone(phone);
  const data = await unisms('/sms', {
    recipient,
    content: otpMessage(otp, purpose),
    sender_id: required('UNISMS_SENDER_ID'),
    metadata: { template: `${purpose}_otp` }
  });
  const message = data?.message || data;
  const status = delivery(message);
  if (status === 'failed') {
    const error = new Error('UniSMS rejected the SMS message.');
    error.code = 'SMS_REJECTED';
    throw error;
  }
  const referenceId = message?.reference_id || data?.reference_id || data?.id || '';
  if (typeof referenceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(referenceId)) throw new Error('UniSMS did not return a valid message reference.');
  return { referenceId, recipient, status };
}
