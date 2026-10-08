// Each server secret has one job, so rotating one does not break the others:
// SESSION_SECRET signs cookies and delivery receipts, APP_PEPPER keys one-time
// code digests, and RECOVERY_ENCRYPTION_KEY encrypts authenticator secrets.
function required(name) {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

export const sessionSecret = () => required('SESSION_SECRET');
export const codePepper = () => required('APP_PEPPER');
export const encryptionSecret = () => required('RECOVERY_ENCRYPTION_KEY');
