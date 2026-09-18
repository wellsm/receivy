import { HttpBadRequestError } from '@ez4/gateway';
import type { InviteLinkContext } from '../../invites/services/links';

/** What an invite link is signed with and where it lands, out of whichever service carries the variables. */
export function inviteLink({ variables }: { variables: { PUBLIC_LINK_HMAC_SECRET: string; PUBLIC_WEB_ORIGIN: string } }): InviteLinkContext {
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
