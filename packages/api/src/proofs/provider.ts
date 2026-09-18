import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { AvatarFiles } from '../storage';
import type { ProofService } from './services/proof';

export declare class ProofProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    // The avatars the responses sign live in their own bucket; the proof objects sit behind the factory.
    avatarFiles: Environment.Service<AvatarFiles>;
    proofs: Environment.Service<ProofService>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    PUBLIC_LINK_HMAC_SECRET: Environment.Variable<'PUBLIC_LINK_HMAC_SECRET'>;
    PUBLIC_WEB_ORIGIN: Environment.VariableOrValue<'PUBLIC_WEB_ORIGIN', 'http://localhost:3000'>;
    NOTIFICATION_PUSH_TRANSPORT: Environment.VariableOrValue<'NOTIFICATION_PUSH_TRANSPORT', 'disabled'>;
    EXPO_ACCESS_TOKEN: Environment.VariableOrValue<'EXPO_ACCESS_TOKEN', 'disabled'>;
  };
}
