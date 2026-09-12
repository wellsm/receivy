import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpNotFoundError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthSessionResponse } from '@receivy/common';
import { beginNativeApple, exchangeNativeApple } from '../../auth/apple-native';
import type { ApiProvider } from '../../provider';
import { enforceQuota, trustedClientIp } from '../../security/throttle';
import { oauthDependencies } from './oauth-shared';

declare class StartRequest implements Http.Request {
  body: { clientChallenge: String.Max<43> };
}
declare class ExchangeRequest implements Http.Request {
  body: {
    state: String.Max<128>;
    authorizationCode: String.Max<2048>;
    codeVerifier: String.Max<128>;
    profile?: String.Max<1024>;
    deviceName?: String.Max<120>;
  };
}
declare class StartResponse implements Http.Response {
  status: 200;
  body: { state: string; nonce: string };
}
declare class ExchangeResponse implements Http.Response {
  status: 200;
  body: AuthSessionResponse;
}
export async function nativeAppleStartHandler(request: StartRequest, context: Service.Context<ApiProvider>): Promise<StartResponse> {
  if (!oauthDependencies('apple', context, true).client) throw new HttpNotFoundError();
  await enforceQuota(context.db, `native-apple-start:${trustedClientIp(request)}`, 30);
  return { status: 200, body: await beginNativeApple(context.db, request.body.clientChallenge) };
}
export async function nativeAppleExchangeHandler(
  request: ExchangeRequest,
  context: Service.Context<ApiProvider>
): Promise<ExchangeResponse> {
  const client = oauthDependencies('apple', context, true).client;
  if (!client) throw new HttpNotFoundError();
  await enforceQuota(context.db, `native-apple-exchange:${trustedClientIp(request)}`, 30);
  return { status: 200, body: await exchangeNativeApple(context.db, request.body, client, context.variables.AUTH_JWT_SECRET) };
}
