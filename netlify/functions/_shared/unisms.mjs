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
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = data?.message?.fail_reason || data?.message?.error || data?.error || data?.message;
    throw new Error(typeof providerMessage === 'string' ? providerMessage : `UniSMS returned ${response.status}.`);
  }
  return data;
}

export async function sendUniSmsOtp(phone, otp) {
  const recipient = normalizeUniSmsPhone(phone);
  if (!/^\d{6}$/.test(String(otp))) throw new Error('The SMS verification code must contain 6 digits.');
  const data = await unisms('/sms', {
    recipient,
    // UniSMS requires the service name and a clear account-reset purpose in
    // transactional SMS content. Keep this concise enough for one SMS part.
    content: `Your Reset Workflow verification code is ${otp} for UniSMS account reset. Do not share.`,
    sender_id: required('UNISMS_SENDER_ID'),
    metadata: { template: 'password_reset_otp' }
  });
  const message = data?.message || data;
  const status = String(message?.status || '').toLowerCase();
  if (['failed', 'rejected', 'error'].includes(status)) {
    throw new Error(message?.fail_reason || 'UniSMS rejected the SMS message.');
  }
  const referenceId = message?.reference_id || data?.reference_id || data?.id || '';
  if (!referenceId) throw new Error('UniSMS did not return a message reference.');
  return { referenceId, recipient };
}
