import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { AvatarFiles, ProofFiles } from '../storage';
import type { UploadExpiryScheduler } from './schedulers/upload-expiry';

export declare class ProofProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    // Both buckets: the proof object lives in one, the avatars the response signs live in the other.
    avatarFiles: Environment.Service<AvatarFiles>;
    proofFiles: Environment.Service<ProofFiles>;
    uploadExpiryScheduler: Environment.Service<UploadExpiryScheduler>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
}
