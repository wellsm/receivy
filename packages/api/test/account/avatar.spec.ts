import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { BucketTester } from '@ez4/local-storage/test';
import { AvatarMime } from '@receivy/common';
import { AvatarInvalidError } from '../../src/users/errors';
import { AuthRepository } from '../../src/users/repositories/auth';
import { AvatarRepository } from '../../src/users/repositories/avatar';
import { cleanupUsers, createUser, db } from '../fixtures/financial';

const user = '61000000-0000-4000-8000-0000000000a1';

describe('avatar upload', () => {
  const bucket = BucketTester.getClientMock('ProofFiles', { keys: {} });

  before(async () => {
    await cleanupUsers(db, [user]);
    await createUser(db, { id: user, email: 'avatar@example.test', name: 'Avatar' });
  });

  after(async () => {
    await cleanupUsers(db, [user]);
  });

  it('signs a write URL for the fixed key', async () => {
    bucket.getWriteUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?put`);

    const ticket = await AvatarRepository.startUpload(bucket, user, AvatarMime.Jpeg);

    equal(ticket.uploadUrl, `https://bucket.test/avatars/${user}?put`);
    ok(Date.parse(ticket.expiresAt) > Date.now());
  });

  it('rejects an oversized file, removes it and keeps the user without photo', async () => {
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/jpeg', size: 3 * 1024 * 1024 }));
    bucket.delete.mock.mockImplementation(async () => undefined);

    await rejects(AvatarRepository.complete(db, bucket, user), AvatarInvalidError);

    equal(bucket.delete.mock.calls.at(-1)?.arguments[0], `avatars/${user}`);
    equal((await AuthRepository.findUserById(db, user))?.avatar, null);
  });

  it('accepts a PNG and exposes the signed avatar', async () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/png', size: 1024 }));
    bucket.getReadUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?get`);

    const result = await AvatarRepository.complete(db, bucket, user, now);

    deepEqual(result, { avatar: { url: `https://bucket.test/avatars/${user}?get`, version: now.toISOString() } });
    deepEqual((await AuthRepository.findUserById(db, user))?.avatar, { url: `avatars/${user}`, version: now.toISOString() });
  });
});
