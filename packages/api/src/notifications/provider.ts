import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { NotificationService } from './services/notification';

export declare class NotificationProvider implements Http.Provider {
  services: {
    notifications: Environment.Service<NotificationService>;
  };
}
