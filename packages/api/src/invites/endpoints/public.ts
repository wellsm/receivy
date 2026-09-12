import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingCategory, BillingType } from '@receivy/common';
import { throttlePublicRead } from '../../common/utils/throttle';
import type { InviteProvider } from '../provider';
import { publicInviteView, resolveInvite } from '../services/links';

declare class PublicTokenRequest implements Http.Request {
  parameters: { token: String.Max<200> };
}

/**
 * The union is written out so reflection publishes both shapes: an unusable invite answers
 * `{ expired: true }` and nothing else, while a live one carries the billing headline.
 */
declare class PublicInviteResponse implements Http.Response {
  status: 200;
  body:
    | { expired: true }
    | {
        expired: false;
        creditorFirstName: string;
        description: string;
        amount: { amountCents: number; currency: 'BRL' };
        type: BillingType;
        participantCount: number;
        category: BillingCategory;
      };
}

export async function publicInviteHandler(
  request: PublicTokenRequest,
  context: Service.Context<InviteProvider>
): Promise<PublicInviteResponse> {
  const invite = await resolveInvite(context.db, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET);
  await throttlePublicRead(context.db, invite.public_id);
  return { status: 200, body: await publicInviteView(context.db, invite) };
}
