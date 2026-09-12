import type { Service } from '@ez4/common';
import type { ChargeRow } from '../../charges/repositories/charge';
import { resolvePublicCharge } from '../../public/repositories/public-link';
import type { ProofProvider } from '../provider';
import { throttleProof } from '../services/throttle';

export type PublicProofActor = { token: string; secret: string };

/** Resolves the link first (404 on a guess), then charges the link's own quota. */
export async function resolveThrottledActor(
  context: Service.Context<ProofProvider>,
  token: string
): Promise<{ charge: ChargeRow; actor: PublicProofActor }> {
  const secret = context.variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await resolvePublicCharge(context.db, token, secret);
  await throttleProof(context.db, charge.public_id ?? charge.id);
  return { charge, actor: { token, secret } };
}
