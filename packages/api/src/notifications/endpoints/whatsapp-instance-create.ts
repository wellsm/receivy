import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { WhatsappInstanceView } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class InstanceRequest implements Http.Request {
  identity: SessionIdentity;
  body: {
    /** The person read the non-official-channel warning and accepted it; refused otherwise. */
    riskAccepted: boolean;
    /** Optional; when given the instance pairs by code ("Conectar com número de telefone") instead of QR. */
    phone?: String.Max<40>;
  };
}

declare class InstanceResponse implements Http.Response {
  status: 201;
  body: WhatsappInstanceView;
}

export async function createWhatsappInstanceHandler({ identity, body }: InstanceRequest, { whatsappInstances }: Service.Context<NotificationProvider>): Promise<InstanceResponse> {
  return { status: 201, body: await whatsappInstances.create(identity.userId, { riskAccepted: body.riskAccepted, phone: body.phone }) };
}
