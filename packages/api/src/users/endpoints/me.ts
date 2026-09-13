import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { AuthUser } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';
import { AuthRepository } from '../repositories/auth';
import { AvatarRepository } from '../repositories/avatar';

declare class MeRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class MeResponse implements Http.Response {
  status: 200;
  body: { user: AuthUser };
}

export async function meHandler(request: MeRequest, { db, proofFiles }: Service.Context<UserProvider>): Promise<MeResponse> {
  const user = await AuthRepository.findUserById(db, request.identity.userId);
  if (!user) {
    throw new HttpUnauthorizedError();
  }
  return { status: 200, body: await AvatarRepository.sign(proofFiles, { user }) };
}
