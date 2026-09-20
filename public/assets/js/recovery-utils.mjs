export const normalizeBackupCode = (value) =>
  String(value || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
export const validBackupCode = (value) =>
  /^[A-F0-9]{32}$/.test(normalizeBackupCode(value));
export const normalizeOtp = (value) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(0, 6);
export function passwordRules(value) {
  return {
    length: value.length >= 12 && value.length <= 128,
    case: /[A-Z]/.test(value) && /[a-z]/.test(value),
    number: /[0-9]/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
    identifier: !/[0-9]{7}/.test(value),
  };
}
export function remainingSeconds(deadline, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function formatCountdown(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
