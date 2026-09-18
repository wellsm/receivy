import type { DbClient } from '../../database';
import { authStore } from '../services/auth-store';
import type { OauthGrantCommit } from './oauth-flow';

export async function commitOauthIdentity(db: DbClient, input: OauthGrantCommit): Promise<string> {
  return await db.transaction(async (tx) => {
    const repo = authStore(tx),
      user = await repo.resolveUser(input);

    await repo.createGrant({
      clientChallenge: input.clientChallenge,
      expiresAt: input.expiresAt,
      grantHash: input.grantHash,
      userId: user.id
    });

    return user.id;
  });
}
