import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../authorizers/session';
import type { listDeliveriesHandler, manualReminderHandler, registerDeviceHandler } from '../notifications/endpoints';
export type NotificationRoutes = [
  Http.UseRoute<{
    name: 'registerDevice';
    path: 'POST /devices';
    authorizer: typeof sessionAuthorizer;
    handler: typeof registerDeviceHandler;
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
