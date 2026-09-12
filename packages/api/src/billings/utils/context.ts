import type { Service } from '@ez4/common';
import { HttpBadRequestError } from '@ez4/gateway';
import type { BillingProvider } from '../provider';
import type { InviteLinkContext } from '../repositories/billing';

export function inviteLink(context: Service.Context<BillingProvider>): InviteLinkContext {
  return { secret: context.variables.PUBLIC_LINK_HMAC_SECRET, webOrigin: context.variables.PUBLIC_WEB_ORIGIN };
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
