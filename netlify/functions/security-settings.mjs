import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { assertPost, handleError, HttpError, json, maskPhone, otpDigest, randomOtp, readJson, sha256 } from './_shared/http.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { base32, codeHash, currentStudent, encryptSecret, matchingStep, rate, recoveryCodes, rpc, sameOrigin, securityNotice } from './_shared/recovery.mjs';
import { canUseUniSmsForPhone, getUniSmsStatus, normalizeUniSmsPhone, sendUniSmsOtp } from './_shared/unisms.mjs';
import { createSmsReceipt, readSmsReceipt } from './_shared/sms-receipt.mjs';
import { policiesAccepted, POLICY_VERSION } from './_shared/onboarding.mjs';

export default async function handler(request) {
  try {
    const {student,session} = await currentStudent(request);
    if (request.method === 'GET') {
      const status = await rpc('recovery_settings',{p_sid:student.id,p_version:session.pv,p_action:'status',p_data:{}});
      return json({...status, ...(status.status === 'ok' ? {maskedPhone:student.phone ? maskPhone(student.phone) : null,
        policiesAccepted:policiesAccepted(student),policyVersion:POLICY_VERSION} : {})});
    }
    assertPost(request); sameOrigin(request);
    const input = await readJson(request);
    const action = String(input.action || '');
    if (action === 'phone_status') {
      const rows = await supabase(`student_recovery?${query({select:'pending_phone_hash,pending_phone_until',student_id:`eq.${student.id}`,limit:1})}`);
      const pending=rows[0];
      const receipt=readSmsReceipt(input.receipt,{sid:student.id,version:session.pv,hash:pending?.pending_phone_hash});
      if (!receipt || !(Date.parse(pending?.pending_phone_until || '') > Date.now())) throw new HttpError(410,'This delivery check has expired. Use your latest phone request.');
      const allowed=await rpc('recovery_rate',{p_key:sha256(`phone-status:${input.receipt}`),p_limit:12});
      if (!allowed) throw new HttpError(429,'Delivery checks are limited. Check your phone before requesting another code.');
      try {
        const delivery=await getUniSmsStatus(receipt.ref);
        return json({status:'ok',deliveryStatus:delivery.status,...(delivery.failureCode ? {deliveryIssue:delivery.failureCode} : {})});
      }
      catch { return json({status:'ok',deliveryStatus:'unknown'}); }
    }
    if (!['accept_policies','begin','confirm','phone_start','phone_confirm','codes','disable'].includes(action)) throw new HttpError(400,'Choose a supported security action.');
    await rate(request,`settings:${student.id}`,20);
    if (action === 'accept_policies') {
      const result = await rpc('accept_student_policies',{p_sid:student.id,p_version:session.pv,
        p_terms:input.termsAccepted === true,p_privacy:input.privacyAccepted === true,p_policy:String(input.policyVersion || '')});
      if (result.status !== 'ok') throw new HttpError(400,'Read and accept the current terms and acknowledge the privacy notice.');
      return json({status:'ok'});
    }
    if (!policiesAccepted(student)) throw new HttpError(403,'Please review the terms and privacy notice before continuing.');
    const rows = await supabase(`student_recovery?${query({select:'secret,pending_secret,codes',student_id:`eq.${student.id}`,limit:1})}`);
    const encrypted = action === 'confirm' ? rows[0]?.pending_secret : rows[0]?.secret;
    const data = {password: String(input.password || ''), secret: encrypted || null,
      step:matchingStep(encrypted,student.id,input.code),hash:otpDigest(`phone:${input.code || ''}`)};
    let secret, codes, otp;
    if (action === 'begin') { secret=base32(randomBytes(20)); data.newSecret=encryptSecret(secret,student.id); }
    if (['confirm','codes'].includes(action)) { codes=recoveryCodes(); data.codes=codes.map(codeHash); }
    if (action === 'phone_start') {
      await rate(request,`phone-enrollment:${student.id}`,3);
      try { data.phone = normalizeUniSmsPhone(input.phone || ''); }
      catch { throw new HttpError(400,'Enter a valid Philippine mobile number.'); }
      if (!/^\+639\d{9}$/.test(data.phone)) throw new HttpError(400,'Enter a Philippine mobile number, such as 0917 123 4567 or +63 917 123 4567.');
      if (!canUseUniSmsForPhone(data.phone)) throw new HttpError(503,'SMS is currently unavailable for this number. Your authenticator and backup codes still work.');
      otp=randomOtp(); data.hash=otpDigest(`phone:${otp}`);
    }
    const result = await rpc(action.startsWith('phone_') ? 'student_phone_settings' : 'recovery_settings',{p_sid:student.id,p_version:session.pv,p_action:action,p_data:data});
    if (result.status !== 'ok') throw new HttpError(result.status === 'limited' ? 429 : 400,
      result.status === 'limited' ? 'Wait before trying again. Five failed attempts lock security changes for 15 minutes; SMS also has a 60-second cooldown.' : 'Could not verify this change. Check your current password and verification code. If you just used an authenticator code, wait for its next code.');
    const output = {status:'ok',message:'Security settings updated.'};
    if (otp) {
      try {
        const sent=await sendUniSmsOtp(data.phone,otp,'phone_verification');
        output.deliveryStatus=sent.status;
        output.deliveryReceipt=createSmsReceipt({sid:student.id,version:session.pv,hash:data.hash,referenceId:sent.referenceId});
      } catch(error) {
        output.deliveryStatus=error.code==='SMS_REJECTED'?'failed':'unknown';
        if (error.code==='SMS_REJECTED' && error.failureCode==='content_rejected') output.deliveryIssue='content_rejected';
      }
      output.message='Phone verification requested. Your number is unchanged until its code is verified.';
    }
    if (data.phone) output.maskedPhone=maskPhone(data.phone);
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
