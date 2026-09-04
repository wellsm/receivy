import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { ApiProvider } from "../provider";
import { HttpUnauthorizedError } from "@ez4/gateway";
import { verifyAccessToken } from "../auth/session";

export type SessionIdentity = { familyId: string; userId: string };

declare class SessionAuthRequest implements Http.AuthRequest {
  headers: { authorization?: string };
}

declare class SessionAuthResponse implements Http.AuthResponse {
  identity: SessionIdentity;
}

export function sessionAuthorizer(
  request: SessionAuthRequest,
  context: Service.Context<ApiProvider>,
): SessionAuthResponse {
  const [scheme, token] = request.headers.authorization?.split(" ") ?? [];

  if (scheme !== "Bearer" || !token) {
    throw new HttpUnauthorizedError();
  }

  try {
    return {
      identity: verifyAccessToken({
        token,
        secret: context.variables.AUTH_JWT_SECRET,
      }),
    };
  } catch {
    throw new HttpUnauthorizedError();
  }
}
