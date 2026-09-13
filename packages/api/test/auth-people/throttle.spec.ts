import { equal, rejects } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProofMime } from '@receivy/common';
import { TooManyRequestsError } from '../../src/common/errors';
import { publicStartProofUploadHandler } from '../../src/proofs/endpoints/public-start-upload';
import { throttleProof } from '../../src/proofs/services/throttle';
import { db } from '../fixtures/financial';

describe('link quotas on PostgreSQL', () => {
  it('answers 404 to guessed capabilities without writing a throttle row', async () => {
    const context = { db, variables: { PUBLIC_LINK_HMAC_SECRET: 'throttle-test-secret-only' } } as Parameters<
      typeof publicStartProofUploadHandler
    >[1];
    const before = await db.proof_throttles.count({});

    for (let index = 0; index < 20; index++) {
      const request = {
        parameters: { token: `invalid-${crypto.randomUUID()}` },
        body: { filename: 'fixture.pdf', mime: ProofMime.Pdf, size: 12 }
      };
      await rejects(
        () => publicStartProofUploadHandler(request, context),
        (error) => (error as { status: number }).status === 404
      );
    }

    equal(await db.proof_throttles.count({}), before);
  });

  it('caps one capability at twelve actions per window and hashes the bucket id', async () => {
    const now = Date.now() + 86400000;

    for (let index = 0; index < 12; index++) await throttleProof(db, 'one-capability', now);
    await rejects(() => throttleProof(db, 'one-capability', now), TooManyRequestsError);
    await throttleProof(db, 'another-capability', now);

    const rows = await db.proof_throttles.findMany({ select: { id: true } });
    equal(
      rows.records.every((row) => /^[a-f0-9]{64}$/.test(row.id)),
      true
    );
    await db.proof_throttles.deleteMany({ where: { expires_at: new Date(now + 600000).toISOString() } });
  });
});
