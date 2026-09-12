import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { commitOauthIdentity } from '../../auth/oauth-commit';
import { completeOauth, OauthFlowError } from '../../auth/oauth-flow';
import type { ApiProvider } from '../../provider';
import { createAuthRepository } from '../../repositories/auth-repository';
import { appendOauthGrant, oauthDependencies } from './oauth-shared';

declare class GoogleCallbackRequest implements Http.Request {
  query: {
    code?: String.Max<2048>;
    error?: String.Max<512>;
    state: String.Max<512>;
  };
}

declare class GoogleCallbackResponse implements Http.Response {
  status: 302;
  headers: { location: string };
}

export async function googleCallbackHandler(
  request: GoogleCallbackRequest,
  context: Service.Context<ApiProvider>
): Promise<GoogleCallbackResponse> {
  const dependencies = oauthDependencies('google', context);
  if (!dependencies.client) {
    throw new HttpNotFoundError();
  }
  try {
    const result = await completeOauth(
      {
        code: request.query.code,
        error: request.query.error,
        provider: 'google',
        state: request.query.state
      },
      {
        providerClient: dependencies.client,
        repo: createAuthRepository(context.db),
        commitGrant: (input) => commitOauthIdentity(context.db, input)
      }
    );
    return {
      status: 302,
      headers: { location: appendOauthGrant(result.destination, result.grant) }
    };
  } catch (error) {
    if (error instanceof OauthFlowError) {
      throw new HttpUnauthorizedError();
    }
    throw error;
  }
}
