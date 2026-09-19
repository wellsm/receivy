import type { DbClient } from '../../database';
import { open } from '../../common/services/secret-box';
import { IntegrationRepository } from '../repositories/integration';

export type CredentialLookup = { status: 'ok'; secret: string } | { status: 'missing' | 'revoked' | 'unreadable' };

/** The decrypted secret of an integration, for the one call that needs it. Never store or log the result. */
export async function credentialOf(db: DbClient, keyB64: string, integrationId: string): Promise<CredentialLookup> {
  const integration = await IntegrationRepository.get(db, integrationId);

  if (!integration) {
    return { status: 'missing' };
  }

  if (integration.revoked_at) {
    return { status: 'revoked' };
  }

  try {
    return { status: 'ok', secret: open(integration.credentials.ciphertext, keyB64) };
  } catch {
    return { status: 'unreadable' };
  }
}
