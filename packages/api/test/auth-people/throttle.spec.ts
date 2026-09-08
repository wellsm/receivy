import { equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { publicUploadProofHandler } from '../../src/proofs/endpoints';
import { throttleProof } from '../../src/proofs/throttle';
import { db } from '../fixtures/financial';

describe('trusted source IP quotas on PostgreSQL', () => {
  it('counts invalid capabilities before lookup so guesses cannot bypass the quota', async () => {
    const context = { db, variables: { PUBLIC_LINK_HMAC_SECRET: 'throttle-test-secret-only' } } as Parameters<
      typeof publicUploadProofHandler
    >[1];
    const request = {
      sourceIp: '192.0.2.211',
      parameters: { token: `invalid-${crypto.randomUUID()}` },
      body: { filename: 'fixture.pdf', mime: 'application/pdf' as const, size: 12 }
    };
    for (let index = 0; index < 12; index++)
      await rejects(
        () => publicUploadProofHandler(request, context),
        (error) => (error as { status: number }).status === 404
      );
    await rejects(
      () => publicUploadProofHandler(request, context),
      (error) => (error as { status: number }).status === 429
    );
  });
  it('isolates real IP buckets while a capability quota survives IP changes', async () => {
    const now = Date.now() + 86400000;
    for (let index = 0; index < 120; index++) await throttleProof(db, `ip-quota-${index}`, now, '192.0.2.1');
    await rejects(() => throttleProof(db, 'ip-quota-exhausted', now, '192.0.2.1'));
    await throttleProof(db, 'fresh-other-ip', now, '192.0.2.2');
    for (let index = 0; index < 12; index++) await throttleProof(db, 'one-capability', now, `198.51.100.${index + 1}`);
    await rejects(() => throttleProof(db, 'one-capability', now, '198.51.100.99'));
    const rows = await db.proof_throttles.findMany({ select: { id: true } });
    equal(
      rows.records.every((row) => /^[a-f0-9]{64}$/.test(row.id)),
      true
    );
    await db.proof_throttles.deleteMany({ where: { expires_at: new Date(now + 600000).toISOString() } });
  });
});
