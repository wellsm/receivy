import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingState, BillingsPage, Direction } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { BillingProvider } from '../provider';
import { BillingRepository } from '../repositories/billing';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    state?: BillingState;
    type?: Direction;
    cursor?: String.Max<500>;
    search?: String.Max<80>;
  };
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: BillingsPage;
}

export async function listBillingsHandler({ query, identity }: ListRequest, { db }: Service.Context<BillingProvider>): Promise<ListResponse> {
  const billings = await BillingRepository.list(db, identity.userId, query);

  return { 
    status: 200, 
    body: billings
  };
}
