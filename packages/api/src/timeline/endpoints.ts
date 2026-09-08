import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PersonLedger, TimelinePage } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { getPersonLedger, getTimeline } from './repository';

declare class TimelineRequest implements Http.Request {
  identity: SessionIdentity;
  query: {
    cursor?: String.Max<500>;
    direction?: 'receivable' | 'payable';
    status?: 'pending' | 'paid' | 'cancelled' | 'overdue';
    source?: 'expense' | 'recurrence';
    from?: String.Date;
    to?: String.Date;
  };
}
declare class LedgerRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  query: { cursor?: String.UUID };
}
declare class TimelineResponse implements Http.Response {
  status: 200;
  body: TimelinePage;
}
declare class LedgerResponse implements Http.Response {
  status: 200;
  body: PersonLedger;
}

export async function timelineHandler(request: TimelineRequest, context: Service.Context<ApiProvider>): Promise<TimelineResponse> {
  return { status: 200, body: await getTimeline(context.db, request.identity.userId, request.query) };
}
export async function personLedgerHandler(request: LedgerRequest, context: Service.Context<ApiProvider>): Promise<LedgerResponse> {
  return { status: 200, body: await getPersonLedger(context.db, request.identity.userId, request.parameters.id, request.query.cursor) };
}
