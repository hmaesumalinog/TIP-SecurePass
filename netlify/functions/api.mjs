// The single HTTP entry point. Every /api/* request runs in this one function,
// so the first request of a visit warms it for all the requests that follow.
// Each endpoint keeps its own module in _routes/; scheduled jobs stay separate.
import adminAudit from './_routes/admin-audit.mjs';
import adminDashboard from './_routes/admin-dashboard.mjs';
import adminIssueTemporaryPassword from './_routes/admin-issue-temporary-password.mjs';
import adminLoginStart from './_routes/admin-login-start.mjs';
import adminLoginVerify from './_routes/admin-login-verify.mjs';
import adminLogout from './_routes/admin-logout.mjs';
import adminPulse from './_routes/admin-pulse.mjs';
import adminRecovery from './_routes/admin-recovery.mjs';
import adminSendReset from './_routes/admin-send-reset.mjs';
import adminSession from './_routes/admin-session.mjs';
import adminStudents from './_routes/admin-students.mjs';
import alternateRecovery from './_routes/alternate-recovery.mjs';
import completeFirstLogin from './_routes/complete-first-login.mjs';
import completeReset from './_routes/complete-reset.mjs';
import health from './_routes/health.mjs';
import login from './_routes/login.mjs';
import logout from './_routes/logout.mjs';
import profile from './_routes/profile.mjs';
import requestReset from './_routes/request-reset.mjs';
import securitySettings from './_routes/security-settings.mjs';
import startReset from './_routes/start-reset.mjs';
import verifyOtp from './_routes/verify-otp.mjs';

export const routes = new Map([
  ['/api/health', health],
  ['/api/login', login],
  ['/api/logout', logout],
  ['/api/complete-first-login', completeFirstLogin],
  ['/api/profile', profile],
  ['/api/security-settings', securitySettings],
  ['/api/request-reset', requestReset],
  ['/api/start-reset', startReset],
  ['/api/verify-otp', verifyOtp],
  ['/api/complete-reset', completeReset],
  ['/api/alternate-recovery', alternateRecovery],
  ['/api/admin/login-start', adminLoginStart],
  ['/api/admin/login-verify', adminLoginVerify],
  ['/api/admin/session', adminSession],
  ['/api/admin/logout', adminLogout],
  ['/api/admin/pulse', adminPulse],
  ['/api/admin/dashboard', adminDashboard],
  ['/api/admin/students', adminStudents],
  ['/api/admin/audit', adminAudit],
  ['/api/admin/recovery', adminRecovery],
  ['/api/admin/send-reset', adminSendReset],
  ['/api/admin/issue-temporary-password', adminIssueTemporaryPassword]
]);

export default async function api(request, context) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const route = routes.get(path);
  if (!route) {
    return Response.json({ message: 'Not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return route(request, context);
}

export const config = { path: '/api/*' };
