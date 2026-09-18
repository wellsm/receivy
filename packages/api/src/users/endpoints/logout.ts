import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { UserProvider } from '../provider';
import { authStore } from '../services/auth-store';
import { revokeSession } from '../services/refresh-session';

declare class LogoutRequest implements Http.Request {
  body: { refreshToken: String.Size<1, 256> };
}

declare class LogoutResponse implements Http.Response {
  status: 204;
}

export async function logoutHandler(request: LogoutRequest, { db }: Service.Context<UserProvider>): Promise<LogoutResponse> {
  await revokeSession(request.body, { repo: authStore(db) });

  return { status: 204 };
}
