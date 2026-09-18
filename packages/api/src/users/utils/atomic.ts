import type { ConfirmEmailCodeBody } from '@receivy/common';
import type { DbClient } from '../../database';
import { authStore } from '../services/auth-store';
import { AuthFlowError, confirmEmailCode } from '../services/email-login';
import { exchangeOauthGrant } from '../services/oauth-flow';

type Config = { codeHashKey: string; accessTokenSecret: string; accessTokenTtlSeconds?: number };

export async function confirmEmailAtomically(db: DbClient, input: ConfirmEmailCodeBody, config: Config) {
  const outcome = await db.transaction(async (tx) => {
    try {
      return await confirmEmailCode(input, { ...config, repo: authStore(tx) });
    } catch (error) {
      // Expected authentication failures must commit the bounded attempt counter.
      // Infrastructure failures still roll back code, identity/link and session.
      if (error instanceof AuthFlowError) {
        return null;
      }

      throw error;
    }
  });

  if (!outcome) {
    throw new AuthFlowError('INVALID_CODE');
  }

  return outcome;
}

export function exchangeOauthAtomically(
  db: DbClient,
  input: { code: string; codeVerifier: string; deviceName?: string },
  config: Pick<Config, 'accessTokenSecret' | 'accessTokenTtlSeconds'>
) {
  return db.transaction(async (tx) => {
    return exchangeOauthGrant(input, { ...config, repo: authStore(tx) });
  });
}
