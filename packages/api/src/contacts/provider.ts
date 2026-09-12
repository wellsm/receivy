import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';

export declare class ContactProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
  };
}
