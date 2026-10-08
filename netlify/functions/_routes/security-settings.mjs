import { randomBytes, randomUUID } from 'node:crypto';
import { assertPost, handleError, HttpError, json, maskPhone, otpDigest, randomOtp, readJson, sha256 } from '../_shared/http.mjs';
import { base32, codeHash, currentStudent, encryptSecret, matchingStep, rateKeys, recoveryCodes, rpc, sameOrigin, securityNotice } from '../_shared/recovery.mjs';
import { canUseUniSmsForPhone, getUniSmsStatus, normalizeUniSmsPhone, sendUniSmsOtp } from '../_shared/unisms.mjs';
import { createSmsReceipt, readSmsReceipt } from '../_shared/sms-receipt.mjs';
import { POLICY_VERSION } from '../_shared/onboarding.mjs';

const ACTIONS = ['accept_policies','begin','confirm','phone_start','phone_confirm','codes','disable'];

export default async function securitySettings(request, context) {
  try {
    if (request.method === 'GET') {
      const {student,recovery} = await currentStudent(request);
      return json({status:'ok',enabled:recovery.enabled,phoneVerified:recovery.phoneVerified,remaining:recovery.remaining,
        // The consumed authenticator step survives removal, so first-time
        // onboarding is shown only once.
        setupCompleted:recovery.setupCompleted,maskedPhone:student.phone ? maskPhone(student.phone) : null,
        policiesAccepted:student.policies_accepted,policyVersion:POLICY_VERSION});
    }
    assertPost(request); sameOrigin(request);
    const input = await readJson(request);
    const action = String(input.action || '');
    if (action === 'phone_status') {
      // Read-only delivery lookup, limited per receipt. Never sends another SMS.
      const {student,recovery,session} = await currentStudent(request);
      const receipt=readSmsReceipt(input.receipt,{sid:student.id,version:session.pv,hash:recovery.pendingPhoneHash});
      if (!receipt || !(Date.parse(recovery.pendingPhoneUntil || '') > Date.now())) throw new HttpError(410,'This delivery check has expired. Use your latest phone request.');
      if (!await rpc('recovery_rate_many',{p_keys:[{key:sha256(`phone-status:${input.receipt}`),limit:12}]}))
        throw new HttpError(429,'Delivery checks are limited. Check your phone before requesting another code.');
      try {
        const delivery=await getUniSmsStatus(receipt.ref);
        return json({status:'ok',deliveryStatus:delivery.status,...(delivery.failureCode ? {deliveryIssue:delivery.failureCode} : {})});
      }
      catch { return json({status:'ok',deliveryStatus:'unknown'}); }
    }
    if (!ACTIONS.includes(action)) throw new HttpError(400,'Choose a supported security action.');
    // Session, hourly limits and current recovery state arrive in one call.
    const {student,recovery,session} = await currentStudent(request,{rate:(current)=>[
      ...rateKeys(request,context,`settings:${current.sid}`,20),
      ...(action === 'phone_start' ? [{key:sha256(`recovery:phone-enrollment:${current.sid}`),limit:3}] : [])
    ]});
    if (action === 'accept_policies') {
      const result = await rpc('accept_student_policies',{p_sid:student.id,p_version:session.pv,
        p_terms:input.termsAccepted === true,p_privacy:input.privacyAccepted === true,p_policy:String(input.policyVersion || '')});
      if (result.status !== 'ok') throw new HttpError(400,'Read and accept the current terms and acknowledge the privacy notice.');
      return json({status:'ok'});
    }
    if (!student.policies_accepted) throw new HttpError(403,'Please review the terms and privacy notice before continuing.');
    const encrypted = action === 'confirm' ? recovery.pendingSecret : recovery.secret;
    const data = {password: String(input.password || ''), secret: encrypted || null,
      step:matchingStep(encrypted,student.id,input.code),hash:otpDigest(`phone:${input.code || ''}`)};
    let secret, codes, otp;
    if (action === 'begin') { secret=base32(randomBytes(20)); data.newSecret=encryptSecret(secret,student.id); }
    if (['confirm','codes'].includes(action)) { codes=recoveryCodes(); data.codes=codes.map(codeHash); }
    if (action === 'phone_start') {
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
      // Loaded only for this step, so other requests start faster.
      const { default: QRCode } = await import('qrcode');
      const uri = `otpauth://totp/${encodeURIComponent(`Reset Workflow:${student.email}`)}?secret=${secret}&issuer=Reset%20Workflow&algorithm=SHA1&digits=6&period=30`;
      output.secret=secret; output.qr=await QRCode.toDataURL(uri,{width:240,margin:2});
      output.message='Scan the QR code or enter the setup key in your authenticator. Confirm within 10 minutes.';
    }
    if (codes) output.codes=codes;
    if (['confirm','codes','disable','phone_confirm'].includes(action)) output.noticeSent=await securityNotice(student.email,action,randomUUID());
    return json(output);
  } catch (error) { return handleError(error); }
}
