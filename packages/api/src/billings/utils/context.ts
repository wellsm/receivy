import type { Service } from '@ez4/common';
import { HttpBadRequestError } from '@ez4/gateway';
import type { InviteLinkContext } from '../../invites/services/links';
import type { BillingProvider } from '../provider';

export function inviteLink({ variables }: Pick<Service.Context<BillingProvider>, 'variables'>): InviteLinkContext {
  return { secret: variables.PUBLIC_LINK_HMAC_SECRET, webOrigin: variables.PUBLIC_WEB_ORIGIN };
}

export async function validation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HttpBadRequestError(error.message);
    }

    throw error;
  }
}
