import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { ProofFiles } from '../storage';
import type { UploadExpiryScheduler } from './schedulers/upload-expiry';

export declare class ProofProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    proofFiles: Environment.Service<ProofFiles>;
    uploadExpiryScheduler: Environment.Service<UploadExpiryScheduler>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
  };
}
