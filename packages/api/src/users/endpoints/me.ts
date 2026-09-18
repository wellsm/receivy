import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AuthUser } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';

declare class MeRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class MeResponse implements Http.Response {
  status: 200;
  body: { user: AuthUser };
}

export async function meHandler({ identity }: MeRequest, { accounts }: Service.Context<UserProvider>): Promise<MeResponse> {
  return { status: 200, body: await accounts.me(identity.userId) };
}
