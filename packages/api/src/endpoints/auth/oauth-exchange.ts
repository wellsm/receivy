import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { AuthSessionResponse } from "@receivy/common";
import type { ApiProvider } from "../../provider";
import { HttpUnauthorizedError } from "@ez4/gateway";
import { exchangeOauthGrant, OauthFlowError } from "../../auth/oauth-flow";
import { createAuthRepository } from "../../repositories/auth-repository";

declare class OauthExchangeRequest implements Http.Request {
  body: {
    codeVerifier: String.Size<43, 128>;
    code: String.Max<512>;
    deviceName?: String.Max<120>;
  };
}

declare class OauthExchangeResponse implements Http.Response {
  status: 200;
  body: AuthSessionResponse;
}

export async function oauthExchangeHandler(
  request: OauthExchangeRequest,
  context: Service.Context<ApiProvider>,
): Promise<OauthExchangeResponse> {
  try {
    const body = await exchangeOauthGrant(request.body, {
      accessTokenSecret: context.variables.AUTH_JWT_SECRET,
      repo: createAuthRepository(context.db),
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof OauthFlowError) {
      throw new HttpUnauthorizedError();
    }
    throw error;
  }
}
