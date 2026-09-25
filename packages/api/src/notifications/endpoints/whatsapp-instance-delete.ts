import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class InstanceRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class InstanceResponse implements Http.Response {
  status: 204;
}

export async function deleteWhatsappInstanceHandler({ identity }: InstanceRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<InstanceResponse> {
  await whatsappInstances.remove(identity.userId);

  return { status: 204 };
}
