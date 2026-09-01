import { assertPost, expiresIn, handleError, HttpError, json, normalizeEmail, randomToken, readJson, sha256 } from './_shared/http.mjs';
import { insert, query, supabase } from './_shared/supabase.mjs';
import { resetEmail, sendEmail } from './_shared/resend.mjs';

const GENERIC_MESSAGE = 'If an account matches that email, a secure reset link has been sent.';

export default async function handler(request, context) {
  try {
    assertPost(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const ip = context?.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
    const identifierHash = sha256(email);
    const ipHash = sha256(ip);
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const recent = await supabase(`reset_requests?${query({ select: 'id,identifier_hash,ip_hash', created_at: `gte.${since}`, or: `(identifier_hash.eq.${identifierHash},ip_hash.eq.${ipHash})` })}`);
    const emailCount = recent.filter((item) => item.identifier_hash === identifierHash).length;
    const ipCount = recent.filter((item) => item.ip_hash === ipHash).length;
    if (emailCount >= 3 || ipCount >= 8) throw new HttpError(429, 'Too many reset requests. Wait 15 minutes before trying again.');
    await insert('reset_requests', { identifier_hash: identifierHash, ip_hash: ipHash }, 'id');

    const students = await supabase(`demo_students?${query({ select: 'id,email,first_name', email: `eq.${email}`, active: 'eq.true', limit: 1 })}`);
    if (!students.length) return json({ message: GENERIC_MESSAGE });

    const student = students[0];
    const token = randomToken();
    const tokenRows = await insert('reset_tokens', {
      student_id: student.id,
      token_hash: sha256(token),
      expires_at: expiresIn(15 * 60)
    }, 'id');
    const origin = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const resetLink = `${origin}/reset.html?token=${encodeURIComponent(token)}`;
    const mail = resetEmail({ firstName: student.first_name, resetLink });
    let delivery = 'sent';
    try {
      const result = await sendEmail({ to: student.email, ...mail, idempotencyKey: `reset-${tokenRows[0].id}` });
      if (result.skipped) delivery = 'skipped_demo';
    } catch (emailError) {
      delivery = 'failed';
      console.error('Reset email delivery failed:', emailError instanceof Error ? emailError.message : 'Unknown error');
    }
    await insert('audit_events', { student_id: student.id, event_type: 'reset_requested', details: { delivery } }, 'id');

    return json({
      message: GENERIC_MESSAGE
    });
  } catch (error) { return handleError(error); }
}
