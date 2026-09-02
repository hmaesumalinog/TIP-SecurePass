import { assertPost, handleError, HttpError, json, otpDigest, readJson, safeEqual } from './_shared/http.mjs';
import { insert, query, supabase, update } from './_shared/supabase.mjs';
import { adminCookie, createAdminSession } from './_shared/admin-session.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { challengeId, code } = await readJson(request);
    if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, 'Enter the six-digit verification code.');
    const rows = await supabase(`admin_login_challenges?${query({ select: 'id,admin_id,otp_hash,expires_at,attempts,verified_at,locked_at', id: `eq.${challengeId}`, limit: 1 })}`);
    const challenge = rows[0];
    if (!challenge || challenge.verified_at || challenge.locked_at || new Date(challenge.expires_at) <= new Date()) throw new HttpError(410, 'This administrator verification code has expired.');
    if (challenge.attempts >= 5) throw new HttpError(423, 'Too many incorrect codes. Start the sign-in again.');
    const correct = safeEqual(challenge.otp_hash, otpDigest(`admin:${code}`));
    const consumedResult = await supabase('rpc/consume_admin_otp_attempt', {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: challenge.id,
        p_correct: correct
      })
    });
    const consumed = Array.isArray(consumedResult) ? consumedResult[0] : consumedResult;
    if (!consumed || consumed.status === 'invalid') throw new HttpError(410, 'This administrator verification code has expired.');
    if (consumed.status !== 'verified') throw new HttpError(401, consumed.remaining > 0 ? `That verification code is incorrect. ${consumed.remaining} attempts remain.` : 'Too many incorrect codes. Start the sign-in again.');
    const admins = await supabase(`admin_accounts?${query({ select: 'id,email,display_name,role,password_changed_at', id: `eq.${consumed.admin_id}`, active: 'eq.true', limit: 1 })}`);
    const admin = admins[0];
    if (!admin) throw new HttpError(403, 'Administrator access is not permitted.');
    await update('admin_accounts', { id: `eq.${admin.id}` }, { last_login_at: new Date().toISOString() });
    await insert('admin_audit_events', { admin_id: admin.id, event_type: 'admin_login_succeeded', details: {} }, 'id');
    const session = createAdminSession(admin);
    return json({ message: 'Administrator signed in.', csrfToken: session.csrf }, 200, { 'Set-Cookie': adminCookie(session.token) });
  } catch (error) {
    return handleError(error);
  }
}
