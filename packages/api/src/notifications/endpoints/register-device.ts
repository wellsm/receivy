import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { DevicePlatform, NotificationDevice } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { NotificationProvider } from '../provider';

declare class DeviceRequest implements Http.Request {
  identity: SessionIdentity;
  body: {
    token: String.Max<300>;
    installationId: String.Max<100>;
    platform: DevicePlatform;
  };
}

declare class DeviceResponse implements Http.Response {
  status: 200;
  body: NotificationDevice;
}

export async function registerDeviceHandler({ identity, body }: DeviceRequest, { notifications }: Service.Context<NotificationProvider>): Promise<DeviceResponse> {
  return { status: 200, body: await notifications.registerDevice(identity.userId, body, identity.familyId) };
}
