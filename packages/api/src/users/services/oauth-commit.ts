import type { DbClient } from '../../database';
import { AuthRepository } from '../repositories/auth';
import { lockAccountReferences } from './locking';
import type { OauthGrantCommit } from './oauth-flow';

export async function commitOauthIdentity(db: DbClient, input: OauthGrantCommit): Promise<void> {
  await db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    const repo = AuthRepository.create(tx),
      user = await repo.resolveUser(input);
    await repo.createGrant({
      clientChallenge: input.clientChallenge,
      expiresAt: input.expiresAt,
      grantHash: input.grantHash,
      userId: user.id
    });
  });
}
