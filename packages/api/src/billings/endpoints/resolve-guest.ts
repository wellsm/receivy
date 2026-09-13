import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingDetail, BillingGuestAction } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { noticeContext } from '../../notifications/services/context';
import type { BillingProvider } from '../provider';
import { resolveGuest } from '../services/guests';
import { inviteLink } from '../utils/context';

declare class GuestRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID; guestId: String.UUID };
  body: { action: 'link'; contactId: String.UUID } | { action: 'add' } | { action: 'dismiss' };
}

declare class DetailResponse implements Http.Response {
  status: 200;
  body: BillingDetail;
}

export async function resolveGuestHandler(
  request: GuestRequest,
  { db, variables, email, chargeNotifyScheduler }: Service.Context<BillingProvider>
): Promise<DetailResponse> {
  const body = await resolveGuest(
    db,
    request.identity.userId,
    request.parameters.id,
    request.parameters.guestId,
    request.body as BillingGuestAction,
    new Date(),
    inviteLink({ variables }),
    noticeContext({ chargeNotifyScheduler, email, variables })
  );

  return { status: 200, body };
}
