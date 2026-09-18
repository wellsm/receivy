import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingsPage, Direction } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { BillingProvider } from '../provider';

declare class ListRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    type?: Direction;
    cursor?: String.Max<500>;
    search?: String.Max<80>;
  };
}

declare class ListResponse implements Http.Response {
  status: 200;
  body: BillingsPage;
}

export async function listBillingsHandler({ query, identity }: ListRequest, { billings }: Service.Context<BillingProvider>): Promise<ListResponse> {
  return { status: 200, body: await billings.list(identity.userId, query) };
}
