import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { Contact } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ContactProvider } from '../provider';
import { ContactRepository } from '../repositories/contact';
import { parseContactInput } from '../utils/parse';

declare class CreateRequest implements Http.Request {
  identity: SessionIdentity;
  body: { name: String.Max<120>; nickname?: String.Max<60>; email?: String.Max<254> };
}

declare class CreateResponse implements Http.Response {
  status: 201;
  body: Contact;
}

export async function createContactHandler(
  request: CreateRequest,
  { db, avatarFiles }: Service.Context<ContactProvider>
): Promise<CreateResponse> {
  return {
    status: 201,
    body: await AvatarRepository.sign(
      avatarFiles,
      await ContactRepository.save(db, request.identity.userId, parseContactInput(request.body))
    )
  };
}
