import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { WhatsappInstanceView } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class InstanceRequest implements Http.Request {
  identity: SessionIdentity;
  query: { refresh?: boolean };
}

declare class InstanceResponse implements Http.Response {
  status: 200;
  body: { instance: WhatsappInstanceView | null };
}

export async function getWhatsappInstanceHandler({ identity, query }: InstanceRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<InstanceResponse> {
  return { status: 200, body: { instance: await whatsappInstances.get(identity.userId, query.refresh === true) } };
}
