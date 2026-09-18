import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofProvider } from '../provider';
import { resolveThrottledActor } from '../utils/actor';

declare class PublicRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

declare class EmptyResponse implements Http.Response {
  status: 204;
}

export async function publicWithdrawProofHandler({ parameters }: PublicRequest, { db, proofs, variables }: Service.Context<ProofProvider>): Promise<EmptyResponse> {
  const { charge, actor } = await resolveThrottledActor({ db, variables }, parameters.token);

  await proofs.withdraw(actor, charge.id);

  return { status: 204 };
}
