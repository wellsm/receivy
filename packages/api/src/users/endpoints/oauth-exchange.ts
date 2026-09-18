import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthSessionResponse } from '@receivy/common';
import type { UserProvider } from '../provider';
import { OauthFlowError } from '../services/oauth-flow';
import { accessTokenConfig } from '../utils/access-token';
import { exchangeOauthAtomically } from '../utils/atomic';

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
  { db, variables }: Service.Context<UserProvider>
): Promise<OauthExchangeResponse> {
  try {
    const body = await exchangeOauthAtomically(db, request.body, accessTokenConfig(variables));

    return { status: 200, body };
  } catch (error) {
    if (error instanceof OauthFlowError) {
      throw new HttpUnauthorizedError();
    }

    throw error;
  }
}
