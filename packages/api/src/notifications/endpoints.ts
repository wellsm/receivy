import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { NotificationDelivery, NotificationDevice } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { noticeContext } from './context';
import { listDeliveries, manualReminder, registerDevice } from './repository';

declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class DeviceRequest implements Http.Request {
  identity: SessionIdentity;
  body: {
    token: String.Max<300>;
    installationId: String.Max<100>;
    platform: 'ios' | 'android';
  };
}
declare class DeviceResponse implements Http.Response {
  status: 200;
  body: NotificationDevice;
}
declare class QueuedResponse implements Http.Response {
  status: 202;
  body: { queued: boolean };
}
declare class DeliveriesResponse implements Http.Response {
  status: 200;
  body: { deliveries: NotificationDelivery[] };
}
export async function registerDeviceHandler(request: DeviceRequest, context: Service.Context<ApiProvider>): Promise<DeviceResponse> {
  return {
    status: 200,
    body: await registerDevice(context.db, request.identity.userId, request.body, request.identity.familyId)
  };
}
export async function manualReminderHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<QueuedResponse> {
  return {
    status: 202,
    body: await manualReminder(context.db, request.identity.userId, request.parameters.id, noticeContext(context))
  };
}
export async function listDeliveriesHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<DeliveriesResponse> {
  return {
    status: 200,
    body: {
      deliveries: await listDeliveries(context.db, request.identity.userId, request.parameters.id)
    }
  };
}
