import { equal } from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import { allowEmailCode } from '../../src/common/utils/throttle';
import { createAuthRepository } from '../../src/users/repositories/auth';
import { requestEmailCode } from '../../src/users/services/email-login';
import { db } from '../fixtures/financial';

const email = `${randomUUID()}@example.com`,
  codeHashKey = 'otp-policy-fixture-key-with-32-bytes';
const hashes = new Set<string>();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
before(async () => {
  await db.proof_throttles.deleteMany({ where: { id: { isIn: [...hashes] } } });
});
after(async () => {
  await db.login_codes.deleteMany({ where: { email } });
  await db.proof_throttles.deleteMany({ where: { id: { isIn: [...hashes] } } });
});
it('serializes first-code creation so simultaneous requests retain anti-enumeration/cooldown', async () => {
  let sent = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      requestEmailCode(
        { email },
        {
          repo: createAuthRepository(db),
          codeHashKey,
          generateCode: () => '123456',
          transport: {
            sendLoginCode: async () => {
              sent++;
            }
          }
        }
      )
    )
  );
  equal(results.filter((result) => result.status === 'fulfilled').length, 5);
  equal(sent, 1);
  equal(await db.login_codes.count({ where: { email } }), 1);
});
it('limits normalized email hashes to five codes per window and leaves other addresses alone', async () => {
  const prefix = randomUUID();
  for (const address of [
    `${prefix}@example.com`,
    ...Array.from({ length: 30 }, (_, index) => `${prefix}-${index}@example.com`),
    `${prefix}-extra@example.com`
  ])
    hashes.add(digest(`otp-request-email:${createHmac('sha256', codeHashKey).update(address).digest('hex')}`));
  for (let index = 0; index < 5; index++) equal(await allowEmailCode(db, `${prefix}@example.com`, codeHashKey), true);
  equal(await allowEmailCode(db, ` ${prefix.toUpperCase()}@EXAMPLE.COM `, codeHashKey), false);
  for (let index = 0; index < 30; index++) equal(await allowEmailCode(db, `${prefix}-${index}@example.com`, codeHashKey), true);
  equal(await allowEmailCode(db, `${prefix}-extra@example.com`, codeHashKey), true);
});
