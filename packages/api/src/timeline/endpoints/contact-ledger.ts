import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ContactLedger } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { TimelineProvider } from '../provider';

declare class LedgerRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  query: { cursor?: String.UUID };
}

declare class LedgerResponse implements Http.Response {
  status: 200;
  body: ContactLedger;
}

export async function contactLedgerHandler({ identity, parameters, query }: LedgerRequest, { ledger }: Service.Context<TimelineProvider>): Promise<LedgerResponse> {
  return { status: 200, body: await ledger.contact(identity.userId, parameters.id, query.cursor) };
}
