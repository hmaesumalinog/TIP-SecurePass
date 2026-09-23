import {createHmac} from 'node:crypto';
import {safeEqual,sha256} from './http.mjs';

function sign(payload) {
  if (!process.env.APP_PEPPER || process.env.APP_PEPPER.length < 32) throw new Error('SMS status signing is not configured.');
  return createHmac('sha256',process.env.APP_PEPPER).update(`phone-delivery-v1:${payload}`).digest('base64url');
}
// Read-only delivery receipt, not a credential or phone-verification grant.
// Binding to the pending code invalidates it on resend, confirmation or change.
export function createSmsReceipt({sid,version,hash,referenceId},now=Date.now()) {
  const payload=Buffer.from(JSON.stringify({sid,version,challenge:sha256(hash),ref:referenceId,exp:now+300000})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function readSmsReceipt(token,{sid,version,hash},now=Date.now()) {
  if(typeof token!=='string'||token.length>1500||!hash)return null;
  const parts=token.split('.');
  if(parts.length!==2||!safeEqual(sign(parts[0]),parts[1]))return null;
  try {
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(data.sid!==sid||data.version!==version||data.challenge!==sha256(hash)||!Number.isFinite(data.exp)||data.exp<=now||data.exp>now+300000||!/^[A-Za-z0-9_-]{1,100}$/.test(data.ref))return null;
    return data;
  } catch {return null;}
}
