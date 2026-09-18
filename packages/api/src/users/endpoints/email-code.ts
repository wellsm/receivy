import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { allowEmailCode } from '../../common/utils/throttle';
import type { UserProvider } from '../provider';
import { authStore } from '../services/auth-store';
import { requestEmailCode } from '../services/email-login';
import { createLoginCodeMailer } from '../services/login-code-email';

declare class EmailCodeRequest implements Http.Request {
  body: { email: String.Email };
}

declare class EmailCodeResponse implements Http.Response {
  status: 204;
}

export async function emailCodeHandler(
  request: EmailCodeRequest,
  { db, email, variables }: Service.Context<UserProvider>
): Promise<EmailCodeResponse> {
  const allowed = await allowEmailCode(db, request.body.email, variables.LOGIN_CODE_HASH_KEY);

  if (!allowed) {
    return { status: 204 };
  }

  await requestEmailCode(request.body, {
    codeHashKey: variables.LOGIN_CODE_HASH_KEY,
    repo: authStore(db),
    transport: createLoginCodeMailer(email, variables.EMAIL_TRANSPORT, variables.RESEND_FROM_EMAIL)
  });

  return { status: 204 };
}
