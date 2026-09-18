import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpNotFoundError, HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { UserProvider } from '../provider';
import { authStore } from '../services/auth-store';
import { OauthProvider } from '../services/oauth';
import { commitOauthIdentity } from '../services/oauth-commit';
import { completeOauth, OauthFlowError } from '../services/oauth-flow';
import { appendOauthGrant, oauthDependencies } from '../utils/oauth';

declare class AppleCallbackRequest implements Http.Request {
  body: String.Max<16384>;
}

declare class AppleCallbackResponse implements Http.Response {
  status: 302;
  headers: { location: string };
}

export async function appleCallbackHandler(
  request: AppleCallbackRequest,
  { db, variables }: Service.Context<UserProvider>
): Promise<AppleCallbackResponse> {
  const dependencies = oauthDependencies(OauthProvider.Apple, { variables });

  if (!dependencies.client) {
    throw new HttpNotFoundError();
  }

  try {
    const form = new URLSearchParams(request.body);
    const code = form.get('code');
    const state = form.get('state');

    if (!state) {
      throw new HttpUnauthorizedError();
    }

    const result = await completeOauth(
      {
        code: code ?? undefined,
        error: form.get('error') ?? undefined,
        profile: form.get('user') ?? undefined,
        provider: OauthProvider.Apple,
        state
      },
      {
        providerClient: dependencies.client,
        repo: authStore(db),
        commitGrant: async (input) => {
          await commitOauthIdentity(db, input);
        }
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
