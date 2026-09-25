import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { WhatsappSender } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class SenderRequest implements Http.Request {
  identity: SessionIdentity;
  body: { sender: WhatsappSender };
}

declare class SenderResponse implements Http.Response {
  status: 200;
  body: { sender: WhatsappSender };
}

export async function patchWhatsappSenderHandler({ identity, body }: SenderRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<SenderResponse> {
  return { status: 200, body: { sender: await whatsappInstances.setSender(identity.userId, body.sender) } };
}
