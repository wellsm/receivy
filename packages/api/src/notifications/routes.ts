import type { Http } from '@ez4/gateway';
import type { sessionAuthorizer } from '../common/authorizers/session';
import type { manualReminderHandler } from './endpoints/manual-reminder';
import type { registerDeviceHandler } from './endpoints/register-device';
import type { reminderPreviewHandler } from './endpoints/reminder-preview';
import type { getWhatsappHandler } from './endpoints/whatsapp-get';
import type { createWhatsappInstanceHandler } from './endpoints/whatsapp-instance-create';
import type { deleteWhatsappInstanceHandler } from './endpoints/whatsapp-instance-delete';
import type { getWhatsappInstanceHandler } from './endpoints/whatsapp-instance-get';
import type { patchWhatsappSenderHandler } from './endpoints/whatsapp-sender-patch';
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
    name: 'reminderPreview';
    path: 'GET /charges/{id}/reminders/preview';
    authorizer: typeof sessionAuthorizer;
    handler: typeof reminderPreviewHandler;
  }>,
  Http.UseRoute<{ name: 'getWhatsapp'; path: 'GET /whatsapp'; authorizer: typeof sessionAuthorizer; handler: typeof getWhatsappHandler }>,
  Http.UseRoute<{ name: 'patchWhatsappSender'; path: 'PATCH /whatsapp/sender'; authorizer: typeof sessionAuthorizer; handler: typeof patchWhatsappSenderHandler }>,
  Http.UseRoute<{ name: 'createWhatsappInstance'; path: 'POST /whatsapp/instance'; authorizer: typeof sessionAuthorizer; handler: typeof createWhatsappInstanceHandler }>,
  Http.UseRoute<{ name: 'getWhatsappInstance'; path: 'GET /whatsapp/instance'; authorizer: typeof sessionAuthorizer; handler: typeof getWhatsappInstanceHandler }>,
  Http.UseRoute<{ name: 'deleteWhatsappInstance'; path: 'DELETE /whatsapp/instance'; authorizer: typeof sessionAuthorizer; handler: typeof deleteWhatsappInstanceHandler }>
];
