// Generates the Script properties for the internal username/password account (see gas/Code.gs → passLogin).
// Usage:  node scripts/make-local-account.mjs <username> <password> [displayName]
// Paste the printed values into Apps Script → Project Settings → Script properties. Never commit the password.
import crypto from 'node:crypto';

export const ITER = 5; // Apps Script computes HMAC slowly; keep this small (rate limiting protects against guessing)
const hex = (buf) => buf.toString('hex');
/** Must stay identical to hashPassword() in gas/Code.gs. */
export function hashPassword(password, salt, iter = ITER) {
  let h = hex(crypto.createHmac('sha256', salt).update(password).digest());
  for (let i = 0; i < iter; i++) h = hex(crypto.createHmac('sha256', salt).update(`${h}:${password}`).digest());
  return h;
}

if (process.argv[1] && process.argv[1].endsWith('make-local-account.mjs')) {
  const [user, password, name] = process.argv.slice(2);
  if (!user || !password) { console.error('Usage: node scripts/make-local-account.mjs <username> <password> [displayName]'); process.exit(1); }
  if (password.length < 10) console.warn('Warning: use a password of at least 10 characters (mix letters, digits, symbols).');
  const salt = crypto.randomBytes(16).toString('hex');
  console.log(`LOCAL_USER = ${user.toLowerCase()}\nLOCAL_SALT = ${salt}\nLOCAL_HASH = ${hashPassword(password, salt)}\nLOCAL_ITER = ${ITER}${name ? `\nLOCAL_NAME = ${name}` : ''}`);
}
