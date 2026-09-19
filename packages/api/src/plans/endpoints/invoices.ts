import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { PlanInvoice } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { PlanProvider } from '../provider';

declare class InvoicesRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class InvoicesResponse implements Http.Response {
  status: 200;
  body: { invoices: PlanInvoice[] };
}

export async function planInvoicesHandler({ identity }: InvoicesRequest, { plans }: Service.Context<PlanProvider>): Promise<InvoicesResponse> {
  return { status: 200, body: { invoices: await plans.invoices(identity.userId) } };
}
