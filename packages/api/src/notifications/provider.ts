import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { NotificationService } from './services/notification';
import type { WhatsappInstanceService } from './services/whatsapp-instance';

export declare class NotificationProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    notifications: Environment.Service<NotificationService>;
    whatsappInstances: Environment.Service<WhatsappInstanceService>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    WHATSAPP_TRANSPORT: Environment.VariableOrValue<'WHATSAPP_TRANSPORT', 'disabled'>;
  };
}
