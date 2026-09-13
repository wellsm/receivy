import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionTokens } from '@receivy/common';
import type { UserProvider } from '../provider';
import { AuthRepository } from '../repositories/auth';
import { refreshSession, SessionFlowError } from '../services/refresh-session';

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
      accessTokenSecret: variables.AUTH_JWT_SECRET,
      repo: AuthRepository.create(db)
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof SessionFlowError) {
      throw new HttpUnauthorizedError();
    }
    throw error;
  }
}
