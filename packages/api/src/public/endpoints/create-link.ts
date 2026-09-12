import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicLink } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { noticeContext } from '../../notifications/services/context';
import type { PublicProvider } from '../provider';
import { createOrRotatePublicLink } from '../repositories/public-link';

declare class PublishRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body?: { paymentMethodId?: String.UUID };
}

declare class LinkResponse implements Http.Response {
  status: 200;
  body: PublicLink;
}

export async function createPublicLinkHandler(request: PublishRequest, context: Service.Context<PublicProvider>): Promise<LinkResponse> {
  return {
    status: 200,
    body: await createOrRotatePublicLink(
      context.db,
      request.identity.userId,
      request.parameters.id,
      context.variables.PUBLIC_LINK_HMAC_SECRET,
      false,
      undefined,
      request.body?.paymentMethodId,
      noticeContext(context)
    )
  };
}
