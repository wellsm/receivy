import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PaymentMethodProvider } from '../provider';
import { PaymentMethodRepository } from '../repositories/payment-method';

declare class ArchiveRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class ArchiveResponse implements Http.Response {
  status: 204;
}

export async function archivePaymentMethodHandler(
  request: ArchiveRequest,
  { db }: Service.Context<PaymentMethodProvider>
): Promise<ArchiveResponse> {
  await PaymentMethodRepository.archive(db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
