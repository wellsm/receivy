import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { WhatsappInstanceView } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class InstanceRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class InstanceResponse implements Http.Response {
  status: 201;
  body: WhatsappInstanceView;
}

export async function createWhatsappInstanceHandler({ identity }: InstanceRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<InstanceResponse> {
  return { status: 201, body: await whatsappInstances.create(identity.userId, { riskAccepted: true }) };
}
