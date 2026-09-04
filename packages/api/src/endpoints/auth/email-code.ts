import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { ApiProvider } from "../../provider";
import { requestEmailCode } from "../../auth/email-login";
import { createEmailTransport } from "../../email/transport";
import { createAuthRepository } from "../../repositories/auth-repository";

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
  const transport = variables.EMAIL_TRANSPORT === "resend"
    ? createEmailTransport({
        mode: "resend",
        apiKey: variables.RESEND_API_KEY,
        from: variables.RESEND_FROM_EMAIL,
      })
    : createEmailTransport({ mode: "disabled" });

  await requestEmailCode(request.body, {
    codeHashKey: variables.LOGIN_CODE_HASH_KEY,
    repo: createAuthRepository(context.db),
    transport,
  });

  return { status: 204 };
}
