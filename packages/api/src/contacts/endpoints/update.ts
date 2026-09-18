import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { Contact } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import { AvatarRepository } from '../../users/repositories/avatar';
import type { ContactProvider } from '../provider';
import type { ContactPaymentMethodBody } from '../utils/body';
import { parseContactInput } from '../utils/parse';

declare class UpdateRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
  body: { name: String.Max<120>; nickname?: String.Max<60>; email?: String.Max<254>; paymentMethod?: ContactPaymentMethodBody };
}

declare class UpdateResponse implements Http.Response {
  status: 200;
  body: Contact;
}

export async function updateContactHandler(
  { identity, parameters, body }: UpdateRequest,
  { avatarFiles, contacts }: Service.Context<ContactProvider>
): Promise<UpdateResponse> {
  return {
    status: 200,
    body: await AvatarRepository.sign(avatarFiles, await contacts.save(identity.userId, parseContactInput(body), parameters.id))
  };
}
