import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthUser } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';
import { AccountRepository } from '../repositories/account';
import { AvatarRepository } from '../repositories/avatar';

declare class ProfileRequest implements Http.Request {
  identity: SessionIdentity;
  body: { name: String.Max<120>; phone?: String.Max<40>; locale: 'pt-BR'; timezone: String.Max<64>; country: 'BR' };
}

declare class ProfileResponse implements Http.Response {
  status: 200;
  body: { user: AuthUser };
}

export async function profileHandler(request: ProfileRequest, { db, avatarFiles }: Service.Context<UserProvider>): Promise<ProfileResponse> {
  return {
    status: 200,
    body: await AvatarRepository.sign(avatarFiles, {
      user: await AccountRepository.updateProfile(db, request.identity.userId, request.body)
    })
  };
}
