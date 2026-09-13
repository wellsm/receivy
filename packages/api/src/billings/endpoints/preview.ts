import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingPreview } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';

declare class ReadRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}

declare class PreviewResponse implements Http.Response {
  status: 200;
  body: { previews: BillingPreview[] };
}

export async function previewBillingHandler(request: ReadRequest, { db }: Service.Context<BillingProvider>): Promise<PreviewResponse> {
  return { status: 200, body: await BillingRepository.preview(db, request.identity.userId, request.parameters.id) };
}
