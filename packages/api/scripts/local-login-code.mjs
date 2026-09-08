// Local-only QA helper. With EMAIL_TRANSPORT=disabled no code is ever printed,
// so this recovers the current 6-digit login code for a fixture e-mail by
// brute-forcing the HMAC with the disposable local LOGIN_CODE_HASH_KEY.
// Refuses to run unless APP_STAGE=local. Usage (from packages/api):
//   node --env-file=local.env scripts/local-login-code.mjs qa-ios@example.invalid

import { execFileSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';

const email = process.argv[2];
if (!email) throw new Error('usage: local-login-code.mjs <email>');
if (process.env.APP_STAGE !== 'local') throw new Error('Refusing: APP_STAGE must be local.');
const secret = process.env.LOGIN_CODE_HASH_KEY;
if (!secret) throw new Error('LOGIN_CODE_HASH_KEY is not set.');
const url = new URL(process.env.EZ4_RAW_PG_DB_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Refusing: database is not loopback.');
const container = process.env.RECEIVY_PG_CONTAINER ?? 'receivy-pg';

const row = execFileSync(
  'docker',
  [
    'exec',
    container,
    'psql',
    '-U',
    decodeURIComponent(url.username),
    '-d',
    url.pathname.slice(1),
    '-tA',
    '-c',
    `select email||'|'||code_hash||'|'||attempts||'|'||coalesce(consumed_at::text,'')||'|'||expires_at from login_codes where lower(email)=lower('${email.replace(/'/g, "''")}') order by created_at desc limit 1`
  ],
  { encoding: 'utf8' }
).trim();
if (!row) throw new Error(`No login_codes row for ${email}.`);
const [storedEmail, hash, attempts, consumed, expires] = row.split('|');
const expected = Buffer.from(hash);
let code = null;
for (let n = 0; n < 1_000_000 && code === null; n++) {
  const candidate = n.toString().padStart(6, '0');
  const actual = Buffer.from(createHmac('sha256', secret).update(storedEmail).update('\0').update(candidate).digest('base64url'));
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) code = candidate;
}
console.log(JSON.stringify({ email: storedEmail, code, attempts: Number(attempts), consumed: consumed || null, expires }));
