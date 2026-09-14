import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpNotFoundError } from '@ez4/gateway';
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

  it('signs a write URL for the staging key', async () => {
    bucket.getWriteUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?put`);

    const ticket = await AvatarRepository.startUpload(bucket, user, AvatarMime.Jpeg);

    equal(ticket.uploadUrl, `https://bucket.test/avatar-uploads/${user}?put`);
    ok(Date.parse(ticket.expiresAt) > Date.now());
  });

  it('rejects an oversized file, removes the staging object and keeps the user without photo', async () => {
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/jpeg', size: 3 * 1024 * 1024 }));
    bucket.delete.mock.mockImplementation(async () => undefined);

    await rejects(AvatarRepository.complete(db, bucket, user), AvatarInvalidError);

    equal(bucket.delete.mock.calls.at(-1)?.arguments[0], `avatar-uploads/${user}`);
    equal((await AuthRepository.findUserById(db, user))?.avatar, null);
  });

  it('accepts a PNG, promotes it from staging and exposes the signed avatar', async () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/png', size: 1024 }));
    bucket.copy.mock.mockImplementation(async () => undefined);
    bucket.delete.mock.mockImplementation(async () => undefined);
    bucket.getReadUrl.mock.mockImplementation(async (key: string) => `https://bucket.test/${key}?get`);

    const result = await AvatarRepository.complete(db, bucket, user, now);

    deepEqual(result, { avatar: { url: `https://bucket.test/avatars/${user}?get`, version: now.toISOString() } });
    deepEqual((await AuthRepository.findUserById(db, user))?.avatar, { url: `avatars/${user}`, version: now.toISOString() });
    deepEqual(bucket.copy.mock.calls.at(-1)?.arguments, [`avatar-uploads/${user}`, `avatars/${user}`]);
    equal(bucket.delete.mock.calls.at(-1)?.arguments[0], `avatar-uploads/${user}`);
  });

  it('rejects a completion for a deleted user and removes the staging object', async () => {
    const deletedUser = '61000000-0000-4000-8000-0000000000a2';

    await cleanupUsers(db, [deletedUser]);
    await createUser(db, { id: deletedUser, email: 'avatar-deleted@example.test', name: 'Avatar deleted' });
    await db.users.updateOne({ where: { id: deletedUser }, data: { deleted_at: new Date().toISOString() } });

    bucket.stat.mock.mockImplementation(async () => ({ type: 'image/png', size: 1024 }));
    bucket.delete.mock.mockImplementation(async () => undefined);

    await rejects(AvatarRepository.complete(db, bucket, deletedUser), HttpNotFoundError);

    equal(bucket.delete.mock.calls.at(-1)?.arguments[0], `avatar-uploads/${deletedUser}`);

    await cleanupUsers(db, [deletedUser]);
  });
});
