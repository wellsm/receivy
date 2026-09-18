import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { AvatarFiles } from '../storage';
import type { ContactService } from './services/contact';

export declare class ContactProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    avatarFiles: Environment.Service<AvatarFiles>;
    contacts: Environment.Service<ContactService>;
  };
}
