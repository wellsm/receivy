import type { Environment, Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { Db } from '../../database';
import { assertActiveSession } from '../../users/repositories/sessions';
import { verifyAccessToken } from '../../users/services/session';

export declare class SessionAuthorizerProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    variables: Environment.ServiceVariables;
  };

  variables: {
    AUTH_JWT_SECRET: Environment.Variable<'AUTH_JWT_SECRET'>;
  };
}

export type SessionIdentity = { familyId: string; userId: string };

declare class SessionAuthRequest implements Http.AuthRequest {
  headers: { authorization?: string };
}

declare class SessionAuthResponse implements Http.AuthResponse {
  identity: SessionIdentity;
}

export async function sessionAuthorizer(
  request: SessionAuthRequest,
  context: Service.Context<SessionAuthorizerProvider>
): Promise<SessionAuthResponse> {
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
