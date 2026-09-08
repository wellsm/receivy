import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { ApiProvider } from "../../provider";
import { requestEmailCode } from "../../auth/email-login";
import { createEmailSender } from "../../email/factory";
import { createEmailTransport } from "../../email/transport";
import { createAuthRepository } from "../../repositories/auth-repository";
import { allowEmailCode } from "../../security/throttle";

declare class EmailCodeRequest implements Http.Request {
  body: { email: String.Email };
}

declare class EmailCodeResponse implements Http.Response {
  status: 204;
}

export async function emailCodeHandler(
  request: EmailCodeRequest,
  context: Service.Context<ApiProvider>,
): Promise<EmailCodeResponse> {
  const { variables } = context;
  if (!await allowEmailCode(context.db, request.body.email, variables.LOGIN_CODE_HASH_KEY, request)) return { status: 204 };
  const transport = createEmailTransport(
    createEmailSender({ transport: variables.EMAIL_TRANSPORT, stage: variables.APP_STAGE, apiKey: variables.RESEND_API_KEY }),
    variables.RESEND_FROM_EMAIL,
  );

  await requestEmailCode(request.body, {
    codeHashKey: variables.LOGIN_CODE_HASH_KEY,
    repo: createAuthRepository(context.db),
    transport,
  });

  return { status: 204 };
}
