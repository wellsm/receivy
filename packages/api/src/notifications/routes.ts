import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { manualReminderHandler } from './endpoints/manual-reminder';
import type { registerDeviceHandler } from './endpoints/register-device';
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
  }>
];
