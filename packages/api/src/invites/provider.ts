import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { InviteService } from './services/invite';

export declare class InviteProvider implements Http.Provider {
  services: {
    invites: Environment.Service<InviteService>;
  };
}
