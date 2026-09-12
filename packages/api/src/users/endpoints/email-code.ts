import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import { requestEmailCode } from '../../auth/email-login';
import { createLoginCodeMailer } from '../../email/login-code';
import type { ApiProvider } from '../../provider';
import { createAuthRepository } from '../../repositories/auth-repository';
import { allowEmailCode } from '../../security/throttle';

declare class EmailCodeRequest implements Http.Request {
  body: { email: String.Email };
}

declare class EmailCodeResponse implements Http.Response {
  status: 204;
}

export async function emailCodeHandler(request: EmailCodeRequest, context: Service.Context<ApiProvider>): Promise<EmailCodeResponse> {
  const { db, email, variables } = context;

  const allowed = await allowEmailCode(db, request.body.email, variables.LOGIN_CODE_HASH_KEY, request);

  if (!allowed) {
    return { status: 204 };
  }

  await requestEmailCode(request.body, {
    codeHashKey: variables.LOGIN_CODE_HASH_KEY,
    repo: createAuthRepository(db),
    transport: createLoginCodeMailer(email, variables.EMAIL_TRANSPORT, variables.RESEND_FROM_EMAIL)
  });

  return { status: 204 };
}
