import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type {
  getPreferencesHandler,
  listDeliveriesHandler,
  listDevicesHandler,
  manualReminderHandler,
  registerDeviceHandler,
  removeDeviceHandler,
  savePreferencesHandler
} from '../notifications/endpoints';
export type NotificationRoutes = [
  Http.UseRoute<{
    name: 'getNotificationPreferences';
    path: 'GET /notification-preferences';
    authorizer: typeof sessionAuthorizer;
    handler: typeof getPreferencesHandler;
  }>,
  Http.UseRoute<{
    name: 'saveNotificationPreferences';
    path: 'PATCH /notification-preferences';
    authorizer: typeof sessionAuthorizer;
    handler: typeof savePreferencesHandler;
  }>,
  Http.UseRoute<{
    name: 'listDevices';
    path: 'GET /devices';
    authorizer: typeof sessionAuthorizer;
    handler: typeof listDevicesHandler;
  }>,
  Http.UseRoute<{
    name: 'registerDevice';
    path: 'POST /devices';
    authorizer: typeof sessionAuthorizer;
    handler: typeof registerDeviceHandler;
  }>,
  Http.UseRoute<{
    name: 'removeDevice';
    path: 'DELETE /devices/{id}';
    authorizer: typeof sessionAuthorizer;
    handler: typeof removeDeviceHandler;
  }>,
  Http.UseRoute<{
    name: 'manualReminder';
    path: 'POST /charges/{id}/reminders';
    authorizer: typeof sessionAuthorizer;
    handler: typeof manualReminderHandler;
  }>,
  Http.UseRoute<{
    name: 'listDeliveries';
    path: 'GET /charges/{id}/deliveries';
    authorizer: typeof sessionAuthorizer;
    handler: typeof listDeliveriesHandler;
  }>
];
