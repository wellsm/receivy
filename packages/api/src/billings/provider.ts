import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { AvatarFiles } from '../storage';
import type { BillingService } from './services/billing';

export declare class BillingProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    avatarFiles: Environment.Service<AvatarFiles>;
    billings: Environment.Service<BillingService>;
  };
}
