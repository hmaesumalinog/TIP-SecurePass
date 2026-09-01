import assert from 'node:assert/strict';
import test from 'node:test';

process.env.APP_PEPPER = 'session-isolation-test-pepper-0123456789abcdef';

const studentSessions = await import('../netlify/functions/_shared/session.mjs');
const adminSessions = await import('../netlify/functions/_shared/admin-session.mjs');

function cookieValue(setCookie) {
  return setCookie.split(';', 1)[0];
}

test('student and administrator sessions coexist without interference', () => {
  const studentToken = studentSessions.createSession({
    id: 'student-test-id',
    password_changed_at: '2026-08-26T00:00:00.000Z'
  });
  const adminSession = adminSessions.createAdminSession({
    id: 'admin-test-id',
    password_changed_at: '2026-08-26T00:00:00.000Z',
    role: 'super_admin'
  });

  const studentCookie = cookieValue(studentSessions.sessionCookie(studentToken));
  const adminCookie = cookieValue(adminSessions.adminCookie(adminSession.token));
  const request = new Request('https://resetworkflow.site/', {
    headers: { Cookie: `${studentCookie}; ${adminCookie}` }
  });

  assert.equal(studentSessions.readSession(request)?.sid, 'student-test-id');
  assert.equal(adminSessions.readAdminSession(request)?.aid, 'admin-test-id');
});

test('first-login session is explicitly setup-only', () => {
  const token = studentSessions.createSession({
    id: 'new-student-id',
    password_changed_at: '2026-08-26T00:00:00.000Z'
  }, { setupOnly: true });
  const request = new Request('https://resetworkflow.site/', {
    headers: { Cookie: cookieValue(studentSessions.sessionCookie(token, 600)) }
  });
  const session = studentSessions.readSession(request);
  assert.equal(session?.sid, 'new-student-id');
  assert.equal(session?.mode, 'setup');
  assert.ok(session.exp - session.iat <= 600);
});

test('student logout clears only the student cookie', () => {
  const clearStudent = studentSessions.clearSessionCookie();
  assert.match(clearStudent, /^tip_securepass_session=/);
  assert.doesNotMatch(clearStudent, /tip_securepass_admin=/);
});

test('administrator logout clears only the administrator cookie', () => {
  const clearAdmin = adminSessions.clearAdminCookie();
  assert.match(clearAdmin, /^tip_securepass_admin=/);
  assert.doesNotMatch(clearAdmin, /tip_securepass_session=/);
});
