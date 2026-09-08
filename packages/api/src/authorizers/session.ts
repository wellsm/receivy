import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import { assertActiveSession } from '../account/sessions';
import { verifyAccessToken } from '../auth/session';
import type { ApiProvider } from '../provider';

export type SessionIdentity = { familyId: string; userId: string };

declare class SessionAuthRequest implements Http.AuthRequest {
  headers: { authorization?: string };
}

declare class SessionAuthResponse implements Http.AuthResponse {
  identity: SessionIdentity;
}

export async function sessionAuthorizer(request: SessionAuthRequest, context: Service.Context<ApiProvider>): Promise<SessionAuthResponse> {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    throw new HttpUnauthorizedError();
  }

  try {
    const identity = verifyAccessToken({
      token,
      secret: context.variables.AUTH_JWT_SECRET
    });
    await assertActiveSession(context.db, identity);
    return { identity };
  } catch {
    throw new HttpUnauthorizedError();
  }
}
