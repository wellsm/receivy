import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { UserProvider } from '../provider';
import { AuthRepository } from '../repositories/auth';
import { OauthProvider } from '../services/oauth';
import { commitOauthIdentity } from '../services/oauth-commit';
import { completeOauth, OauthFlowError } from '../services/oauth-flow';
import { appendOauthGrant, oauthDependencies } from '../utils/oauth';

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
  { db, variables }: Service.Context<UserProvider>
): Promise<GoogleCallbackResponse> {
  const dependencies = oauthDependencies(OauthProvider.Google, { variables });
  if (!dependencies.client) {
    throw new HttpNotFoundError();
  }
  try {
    const result = await completeOauth(
      {
        code: request.query.code,
        error: request.query.error,
        provider: OauthProvider.Google,
        state: request.query.state
      },
      {
        providerClient: dependencies.client,
        repo: AuthRepository.create(db),
        commitGrant: (input) => commitOauthIdentity(db, input)
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
