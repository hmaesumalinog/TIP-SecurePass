const PROVIDER_PREFIX = 'provider:infobip:';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function baseUrl() {
  const value = required('INFOBIP_BASE_URL').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!/^[a-z0-9.-]+\.api\.infobip\.com$/i.test(value)) throw new Error('INFOBIP_BASE_URL is invalid.');
  return `https://${value}`;
}

async function infobip(path, body) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `App ${required('INFOBIP_API_KEY')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = data?.requestError?.serviceException?.text || data?.requestError?.serviceException?.messageId;
    throw new Error(providerMessage || `Infobip returned ${response.status}.`);
  }
  return data;
}

export function normalizeInfobipPhone(value) {
  let digits = String(value || '').trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `63${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) throw new Error('The registered phone number is invalid.');
  return digits;
}

export function canUseInfobipForPhone(phone) {
  if (process.env.SMS_PROVIDER !== 'infobip') return false;
  const requiredNames = ['INFOBIP_BASE_URL', 'INFOBIP_API_KEY', 'INFOBIP_SMS_FROM'];
  if (!requiredNames.every((name) => String(process.env[name] || '').trim())) return false;
  if (process.env.INFOBIP_TRIAL_MODE !== 'true') return true;
  const allowed = String(process.env.INFOBIP_TRIAL_ALLOWED_PHONE || '')
    .split(',')
    .map((item) => item.trim().replace(/\D/g, ''))
    .filter(Boolean);
  return allowed.includes(normalizeInfobipPhone(phone));
}

export async function sendInfobipOtp(phone, otp) {
  const to = normalizeInfobipPhone(phone);
  if (!/^\d{6}$/.test(String(otp))) throw new Error('The SMS verification code must contain 6 digits.');
  const data = await infobip('/sms/3/messages', {
    messages: [{
      sender: required('INFOBIP_SMS_FROM'),
      destinations: [{ to }],
      content: {
        text: `Your Reset Workflow verification code is ${otp}. It expires in 5 minutes. Do not share it.`
      }
    }]
  });
  const message = data?.messages?.[0];
  if (!message?.messageId) throw new Error('Infobip did not accept the SMS message.');
  if (message.status?.groupName && message.status.groupName !== 'PENDING') {
    throw new Error(message.status.description || 'Infobip rejected the SMS message.');
  }
  return { messageId: message.messageId, to };
}

export async function sendInfobipPin(phone) {
  const to = normalizeInfobipPhone(phone);
  const data = await infobip('/2fa/2/pin', {
    applicationId: required('INFOBIP_2FA_APPLICATION_ID'),
    messageId: required('INFOBIP_2FA_MESSAGE_ID'),
    from: required('INFOBIP_SMS_FROM'),
    to
  });
  if (!data.pinId || !/^[A-Za-z0-9_-]{8,200}$/.test(data.pinId)) throw new Error('Infobip did not return a valid PIN reference.');
  return { reference: `${PROVIDER_PREFIX}${data.pinId}`, to };
}

export function isInfobipReference(value) {
  return String(value || '').startsWith(PROVIDER_PREFIX);
}

export async function verifyInfobipPin(reference, pin) {
  const pinId = String(reference || '').slice(PROVIDER_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(pinId)) throw new Error('The Infobip PIN reference is invalid.');
  const data = await infobip(`/2fa/2/pin/${encodeURIComponent(pinId)}/verify`, { pin: String(pin) });
  return data.verified === true;
}
