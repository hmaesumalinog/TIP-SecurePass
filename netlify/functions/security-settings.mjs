import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { assertPost, handleError, HttpError, json, maskPhone, otpDigest, randomOtp, readJson } from './_shared/http.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { base32, codeHash, currentStudent, encryptSecret, matchingStep, rate, recoveryCodes, rpc, sameOrigin, securityNotice } from './_shared/recovery.mjs';
import { canUseUniSmsForPhone, sendUniSmsOtp } from './_shared/unisms.mjs';

export default async function handler(request) {
  try {
    const {student,session} = await currentStudent(request);
    if (request.method === 'GET') {
      const status = await rpc('recovery_settings',{p_sid:student.id,p_version:session.pv,p_action:'status',p_data:{}});
      return json({...status, ...(status.status === 'ok' ? {maskedPhone:maskPhone(student.phone)} : {})});
    }
    assertPost(request); sameOrigin(request);
    const input = await readJson(request);
    const action = String(input.action || '');
    if (!['begin','confirm','phone_start','phone_confirm','codes','disable'].includes(action)) throw new HttpError(400,'Choose a supported security action.');
    await rate(request,`settings:${student.id}`,20);
    const rows = await supabase(`student_recovery?${query({select:'secret,pending_secret,codes',student_id:`eq.${student.id}`,limit:1})}`);
    const encrypted = action === 'confirm' ? rows[0]?.pending_secret : rows[0]?.secret;
    const data = {password: String(input.password || ''), secret: encrypted || null,
      step:matchingStep(encrypted,student.id,input.code),hash:otpDigest(`phone:${input.code || ''}`)};
    let secret, codes, otp;
    if (action === 'begin') { secret=base32(randomBytes(20)); data.newSecret=encryptSecret(secret,student.id); }
    if (['confirm','codes'].includes(action)) { codes=recoveryCodes(); data.codes=codes.map(codeHash); }
    if (action==='phone_confirm' && !rows[0]?.secret && !rows[0]?.codes?.length) { codes=recoveryCodes(); data.codes=codes.map(codeHash); }
    if (action === 'phone_start') {
      await rate(request,`phone-enrollment:${student.id}`,3);
      if (!canUseUniSmsForPhone(student.phone)) throw new HttpError(503,'SMS is currently unavailable. Use an authenticator or contact the administrator.');
      otp=randomOtp(); data.hash=otpDigest(`phone:${otp}`);
    }
    const result = await rpc('recovery_settings',{p_sid:student.id,p_version:session.pv,p_action:action,p_data:data});
    if (result.status !== 'ok') throw new HttpError(result.status === 'limited' ? 429 : 400,
      result.status === 'limited' ? 'Wait before trying again. Five failed attempts lock security changes for 15 minutes; SMS also has a 60-second cooldown.' : 'Could not verify this change. Check your current password and verification code. If you just used an authenticator code, wait for its next code.');
    if (otp) {
      try { await sendUniSmsOtp(student.phone,otp); }
      catch { throw new HttpError(502,'SMS delivery could not be confirmed. If a code arrives, you can still enter it. Wait at least 60 seconds before trying again.'); }
    }
    const output = {status:'ok',message:'Security settings updated.'};
    if (secret) {
      const uri = `otpauth://totp/${encodeURIComponent(`Reset Workflow:${student.email}`)}?secret=${secret}&issuer=Reset%20Workflow&algorithm=SHA1&digits=6&period=30`;
      output.secret=secret; output.qr=await QRCode.toDataURL(uri,{width:240,margin:2});
      output.message='Scan the QR code or enter the setup key in your authenticator. Confirm within 10 minutes.';
    }
    if (codes) output.codes=codes;
    if (['confirm','codes','disable','phone_confirm'].includes(action)) output.noticeSent=await securityNotice(student.email,action,randomUUID());
    return json(output);
  } catch (error) { return handleError(error); }
}
