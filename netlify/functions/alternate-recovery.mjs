import { assertPost, handleError, HttpError, json, otpDigest, randomOtp, randomToken, readJson, sha256, validatePassword } from './_shared/http.mjs';
import { insert, query, supabase } from './_shared/supabase.mjs';
import { codeHash, matchingStep, rate, rpc, securityNotice } from './_shared/recovery.mjs';
import { canUseUniSmsForPhone, sendUniSmsOtp } from './_shared/unisms.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const input = await readJson(request);
    const number = String(input.studentNumber || '');
    if (['start','help'].includes(input.action)) {
      if (!/^\d{7}$/.test(number)) throw new HttpError(400,'Enter your seven-digit student number.');
      await rate(request,`recovery:${number}`,8);
      if (input.action === 'help') {
        const contact = String(input.contact || '').trim(), message = String(input.message || '').trim();
        if (contact.length < 5 || contact.length > 254 || message.length < 10 || message.length > 1000) throw new HttpError(400,'Provide a reachable contact (5–254 characters) and explanation (10–1000 characters). Do not include passwords or recovery codes.');
        await insert('recovery_help_requests',{student_number:number,contact,message},'id');
        return json({message:'Your request has been recorded for administrator review. This does not reset your password or verify your identity. An administrator can use the contact you provided after reviewing your request; there is no guaranteed response time.'});
      }
      if (!['authenticator','sms'].includes(input.method)) throw new HttpError(400,'Choose an authenticator or SMS.');
      const token=randomToken(), otp=randomOtp();
      const result=await rpc('alternate_start',{p_number:number,p_code:codeHash(input.backupCode),p_method:input.method,p_token:sha256(token),p_otp:otpDigest(`alternate:${otp}`)});
      if (result.status === 'ok' && input.method === 'sms') {
        if (canUseUniSmsForPhone(result.phone)) {
          try { await sendUniSmsOtp(result.phone,otp); } catch { console.error('Alternate recovery SMS delivery unconfirmed.'); }
        }
      }
      // Same response for unknown accounts, unavailable factors and incorrect codes.
      return json({token,message:input.method==='sms' ? 'If these details match an eligible account, a code will be sent to its previously verified phone. It expires in five minutes.' : 'Enter a code from the authenticator previously enrolled on this account. This request expires in five minutes.'});
    }
    const token=String(input.token || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(400,'Start a new recovery request.');
    await rate(request,`grant:${sha256(token)}`,10);
    if (input.action==='verify') {
      const rows=await supabase(`alternate_recovery?${query({select:'student_id,secret,method',token_hash:`eq.${sha256(token)}`,limit:1})}`);
      const challenge=rows[0];
      const step=challenge?.method==='authenticator' ? matchingStep(challenge.secret,challenge.student_id,input.code) : -1;
      const result=await rpc('alternate_verify',{p_token:sha256(token),p_otp:otpDigest(`alternate:${input.code || ''}`),p_step:step,p_secret:challenge?.secret || null});
      if (result.status!=='ok') throw new HttpError(400,'Recovery details could not be verified, have expired, or reached the attempt limit. Check your details or start again.');
      return json({message:'Verified. Set your new password within 10 minutes. Your backup code has now been used.'});
    }
    if (input.action==='complete') {
      if (!validatePassword(input.password)) throw new HttpError(400,'Use 12–128 characters including uppercase, lowercase, a number and symbol. Do not include a student number.');
      const result=await rpc('alternate_finish',{p_token:sha256(token),p_password:input.password});
      if (result.status!=='ok') throw new HttpError(400,'The reset could not be completed. Check the password requirements or start a new recovery request.');
      const noticeSent=await securityNotice(result.email,'password reset',result.event);
      return json({message:'Password updated. Previous sessions and recovery requests are invalid. Your enrolled recovery methods remain unchanged.',noticeSent});
    }
    throw new HttpError(400,'Choose a supported recovery action.');
  } catch (error) { return handleError(error); }
}
