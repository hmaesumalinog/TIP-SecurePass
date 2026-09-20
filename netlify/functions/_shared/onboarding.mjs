export const POLICY_VERSION = '2026-09-20';
export const policiesAccepted = (student) => student.terms_version === POLICY_VERSION && student.privacy_version === POLICY_VERSION;
export function validBirthday(value, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) return false;
  const age = ageFromBirthday(value, now);
  return age >= 15 && age <= 100 && date <= now;
}
export function ageFromBirthday(value, now = new Date()) {
  if (!value) return null;
  const birthday = new Date(`${value}T00:00:00Z`);
  return now.getUTCFullYear()-birthday.getUTCFullYear() - (now.toISOString().slice(5,10)<value.slice(5,10) ? 1 : 0);
}
