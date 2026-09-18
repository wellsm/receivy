import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { PublicLinkService } from './services/public-link';

export declare class PublicProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    publicLinks: Environment.Service<PublicLinkService>;
  };
}
