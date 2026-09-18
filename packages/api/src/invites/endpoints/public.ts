import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { BillingCategory, BillingRecurrence } from '@receivy/common';
import type { InviteProvider } from '../provider';

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
        recurrence: BillingRecurrence;
        participantCount: number;
        category: BillingCategory;
      };
}

export async function publicInviteHandler({ parameters }: PublicTokenRequest, { invites }: Service.Context<InviteProvider>): Promise<PublicInviteResponse> {
  return { status: 200, body: await invites.preview(parameters.token) };
}
