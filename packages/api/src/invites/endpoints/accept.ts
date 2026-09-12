import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { InviteAcceptResult } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { INVITE_ACCEPT, throttlePublicRead } from '../../common/utils/throttle';
import { noticeContext } from '../../notifications/services/context';
import { pushToUser } from '../../notifications/services/direct';
import { notificationTransport } from '../../notifications/services/transport';
import type { InviteProvider } from '../provider';
import { acceptInvite } from '../repositories/invite';
import { resolveInvite } from '../services/links';

declare class AcceptRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { token: String.Max<200> };
}

declare class AcceptResponse implements Http.Response {
  status: 200;
  body: InviteAcceptResult;
}

export async function acceptInviteHandler(request: AcceptRequest, context: Service.Context<InviteProvider>): Promise<AcceptResponse> {
  const invite = await resolveInvite(context.db, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET);
  await throttlePublicRead(context.db, invite.public_id, INVITE_ACCEPT);

  const { waiting, ...body } = await acceptInvite(
    context.db,
    request.identity.userId,
    request.parameters.token,
    context.variables.PUBLIC_LINK_HMAC_SECRET,
    new Date(),
    noticeContext(context)
  );

  // The owner learns right away that someone is waiting; the card on the billing detail is the fallback.
  if (waiting) {
    await pushToUser(context.db, notificationTransport(context.variables, globalThis.fetch, context.email), waiting.ownerId, {
      title: `Alguém entrou em «${waiting.description}»`,
      body: `${waiting.guestName} entrou pelo link. Diga quem é para liberar a cobrança.`,
      url: `${context.variables.PUBLIC_WEB_ORIGIN}/billings/${body.billingId}`
    });
  }

  return { status: 200, body };
}
