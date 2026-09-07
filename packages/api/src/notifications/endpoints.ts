import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { Integer, String } from "@ez4/schema";
import type {
  NotificationDelivery,
  NotificationDevice,
  NotificationPreferences,
} from "@receivy/common";
import type { SessionIdentity } from "../authorizers/session";
import type { ApiProvider } from "../provider";
import {
  getPreferences,
  savePreferences,
  listDevices,
  registerDevice,
  removeDevice,
  manualReminder,
  listDeliveries,
} from "./repository";
declare class Request implements Http.Request {
  identity: SessionIdentity;
}
declare class IdRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class PreferencesRequest implements Http.Request {
  identity: SessionIdentity;
  body: {
    emailEnabled: boolean;
    pushEnabled: boolean;
    reminderOffsets: Integer.Range<-90, 90>[];
  };
}
declare class DeviceRequest implements Http.Request {
  identity: SessionIdentity;
  body: {
    token: String.Max<300>;
    installationId: String.Max<100>;
    platform: "ios" | "android";
  };
}
declare class PreferencesResponse implements Http.Response {
  status: 200;
  body: NotificationPreferences;
}
declare class DevicesResponse implements Http.Response {
  status: 200;
  body: { devices: NotificationDevice[] };
}
declare class DeviceResponse implements Http.Response {
  status: 200;
  body: NotificationDevice;
}
declare class EmptyResponse implements Http.Response {
  status: 204;
}
declare class QueuedResponse implements Http.Response {
  status: 202;
  body: { queued: boolean };
}
declare class DeliveriesResponse implements Http.Response {
  status: 200;
  body: { deliveries: NotificationDelivery[] };
}
export async function getPreferencesHandler(
  request: Request,
  context: Service.Context<ApiProvider>,
): Promise<PreferencesResponse> {
  return {
    status: 200,
    body: await getPreferences(context.db, request.identity.userId),
  };
}
export async function savePreferencesHandler(
  request: PreferencesRequest,
  context: Service.Context<ApiProvider>,
): Promise<PreferencesResponse> {
  return {
    status: 200,
    body: await savePreferences(
      context.db,
      request.identity.userId,
      request.body,
    ),
  };
}
export async function listDevicesHandler(
  request: Request,
  context: Service.Context<ApiProvider>,
): Promise<DevicesResponse> {
  return {
    status: 200,
    body: { devices: await listDevices(context.db, request.identity.userId) },
  };
}
export async function registerDeviceHandler(
  request: DeviceRequest,
  context: Service.Context<ApiProvider>,
): Promise<DeviceResponse> {
  return {
    status: 200,
    body: await registerDevice(
      context.db,
      request.identity.userId,
      request.body,
      request.identity.familyId,
    ),
  };
}
export async function removeDeviceHandler(
  request: IdRequest,
  context: Service.Context<ApiProvider>,
): Promise<EmptyResponse> {
  await removeDevice(
    context.db,
    request.identity.userId,
    request.parameters.id,
  );
  return { status: 204 };
}
export async function manualReminderHandler(
  request: IdRequest,
  context: Service.Context<ApiProvider>,
): Promise<QueuedResponse> {
  return {
    status: 202,
    body: await manualReminder(
      context.db,
      request.identity.userId,
      request.parameters.id,
    ),
  };
}
export async function listDeliveriesHandler(
  request: IdRequest,
  context: Service.Context<ApiProvider>,
): Promise<DeliveriesResponse> {
  return {
    status: 200,
    body: {
      deliveries: await listDeliveries(
        context.db,
        request.identity.userId,
        request.parameters.id,
      ),
    },
  };
}
