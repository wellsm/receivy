import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { NotificationService } from './services/notification';
import type { WhatsappInstanceService } from './services/whatsapp-instance';

export declare class NotificationProvider implements Http.Provider {
  services: {
    notifications: Environment.Service<NotificationService>;
    whatsappInstances: Environment.Service<WhatsappInstanceService>;
  };
}
