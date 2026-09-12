import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { SessionTokens } from '@receivy/common';
import { refreshSession, SessionFlowError } from '../../auth/refresh-session';
import type { ApiProvider } from '../../provider';
import { createAuthRepository } from '../../repositories/auth-repository';

declare class RefreshRequest implements Http.Request {
  body: { refreshToken: String.Size<1, 256> };
}

declare class RefreshResponse implements Http.Response {
  status: 200;
  body: SessionTokens;
}

export async function refreshHandler(request: RefreshRequest, context: Service.Context<ApiProvider>): Promise<RefreshResponse> {
  try {
    const body = await refreshSession(request.body, {
      accessTokenSecret: context.variables.AUTH_JWT_SECRET,
      repo: createAuthRepository(context.db)
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof SessionFlowError) {
      throw new HttpUnauthorizedError();
    }
    throw error;
  }
}
