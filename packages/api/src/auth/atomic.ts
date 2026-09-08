import type { ConfirmEmailCodeBody } from '@receivy/common';
import { lockAccountReferences } from '../account/locking';
import type { DbClient } from '../database';
import { createAuthRepository } from '../repositories/auth-repository';
import { AuthFlowError, confirmEmailCode } from './email-login';
import { exchangeOauthGrant } from './oauth-flow';

type Config = { codeHashKey: string; accessTokenSecret: string };

export async function confirmEmailAtomically(db: DbClient, input: ConfirmEmailCodeBody, config: Config) {
  const outcome = await db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    try {
      return await confirmEmailCode(input, { ...config, repo: createAuthRepository(tx) });
    } catch (error) {
      // Expected authentication failures must commit the bounded attempt counter.
      // Infrastructure failures still roll back code, identity/link and session.
      if (error instanceof AuthFlowError) return null;
      throw error;
    }
  });
  if (!outcome) throw new AuthFlowError('INVALID_CODE');
  return outcome;
}

export function exchangeOauthAtomically(
  db: DbClient,
  input: { code: string; codeVerifier: string; deviceName?: string },
  config: Pick<Config, 'accessTokenSecret'>
) {
  return db.transaction(async (tx) => {
    await lockAccountReferences(tx, 'write');
    return exchangeOauthGrant(input, { ...config, repo: createAuthRepository(tx) });
  });
}
