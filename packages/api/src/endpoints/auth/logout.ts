import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { ApiProvider } from "../../provider";
import { revokeSession } from "../../auth/refresh-session";
import { createAuthRepository } from "../../repositories/auth-repository";

declare class LogoutRequest implements Http.Request {
  body: { refreshToken: String.Size<1, 256> };
}

declare class LogoutResponse implements Http.Response {
  status: 204;
}

export async function logoutHandler(
  request: LogoutRequest,
  context: Service.Context<ApiProvider>,
): Promise<LogoutResponse> {
  await revokeSession(request.body, { repo: createAuthRepository(context.db) });
  return { status: 204 };
}
