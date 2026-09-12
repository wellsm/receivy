import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpBadRequestError, HttpNotFoundError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { UserProvider } from '../provider';
import { createAuthRepository } from '../repositories/auth';
import { beginOauth, OauthFlowError } from '../services/oauth-flow';
import { oauthDependencies } from '../utils/oauth';

declare class OauthStartRequest implements Http.Request {
  body: {
    clientChallenge: String.Size<43, 43>;
    provider: 'apple' | 'google';
    destination: String.Max<512>;
  };
}

declare class OauthStartResponse implements Http.Response {
  status: 200;
  body: { authorizationUrl: string };
}

export async function oauthStartHandler(request: OauthStartRequest, context: Service.Context<UserProvider>): Promise<OauthStartResponse> {
  const dependencies = oauthDependencies(request.body.provider, context);
  try {
    const body = await beginOauth(request.body, {
      allowList: dependencies.allowList,
      providerClient: dependencies.client,
      repo: createAuthRepository(context.db)
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof OauthFlowError) {
      if (error.code === 'PROVIDER_DISABLED') {
        throw new HttpNotFoundError();
      }
      throw new HttpBadRequestError();
    }
    throw error;
  }
}
