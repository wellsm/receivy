import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingsPage } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { BillingProvider } from '../provider';
import { listBillings } from '../repositories/billing';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    type?: 'once' | 'until' | 'indefinite';
    state?: 'active' | 'paused' | 'ended';
    direction?: 'receivable' | 'payable';
    cursor?: String.Max<500>;
    search?: String.Max<80>;
    category?: 'food' | 'transport' | 'groceries' | 'subscription' | 'loan' | 'housing' | 'travel' | 'other';
  };
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: BillingsPage;
}

export async function listBillingsHandler(request: ListRequest, context: Service.Context<BillingProvider>): Promise<ListResponse> {
  return { status: 200, body: await listBillings(context.db, request.identity.userId, request.query) };
}
