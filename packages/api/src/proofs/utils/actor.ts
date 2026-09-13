import type { Service } from '@ez4/common';
import type { ChargeRepository } from '../../charges/repositories/charge';
import { PublicLinkRepository } from '../../public/repositories/public-link';
import type { ProofProvider } from '../provider';
import { throttleProof } from '../services/throttle';

export type PublicProofActor = { token: string; secret: string };

/** Resolves the link first (404 on a guess), then charges the link's own quota. */
export async function resolveThrottledActor(
  { db, variables }: Pick<Service.Context<ProofProvider>, 'db' | 'variables'>,
  token: string
): Promise<{ charge: ChargeRepository.Row; actor: PublicProofActor }> {
  const secret = variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await PublicLinkRepository.resolveCharge(db, token, secret);
  await throttleProof(db, charge.public_id ?? charge.id);
  return { charge, actor: { token, secret } };
}
