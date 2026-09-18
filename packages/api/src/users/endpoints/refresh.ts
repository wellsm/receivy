import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionTokens } from '@receivy/common';
import { StaleSessionError } from '../errors';
import type { UserProvider } from '../provider';
import { authStore } from '../services/auth-store';
import { refreshSession, SessionFlowError } from '../services/refresh-session';
import { accessTokenConfig } from '../utils/access-token';

declare class RefreshRequest implements Http.Request {
  body: { refreshToken: String.Size<1, 256> };
}

declare class RefreshResponse implements Http.Response {
  status: 200;
  body: SessionTokens;
}

export async function refreshHandler(request: RefreshRequest, { db, variables }: Service.Context<UserProvider>): Promise<RefreshResponse> {
  try {
    const body = await refreshSession(request.body, {
      ...accessTokenConfig(variables),
      repo: authStore(db)
    });

    return { status: 200, body };
  } catch (error) {
    if (error instanceof SessionFlowError) {
      throw error.code === 'STALE_SESSION' ? new StaleSessionError() : new HttpUnauthorizedError();
    }

    throw error;
  }
}
