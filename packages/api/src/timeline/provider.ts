import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { ProofFiles } from '../storage';

export declare class TimelineProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
  };
}
