import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import { HttpUnauthorizedError } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthSessionResponse } from '@receivy/common';
import { confirmEmailAtomically } from '../../auth/atomic';
import { AuthFlowError } from '../../auth/email-login';
import type { ApiProvider } from '../../provider';
import { enforceQuota, trustedClientIp } from '../../security/throttle';

declare class EmailConfirmRequest implements Http.Request {
  body: {
    email: String.Email;
    code: String.Size<6, 6>;
    deviceName?: String.Max<120>;
  };
}

declare class EmailConfirmResponse implements Http.Response {
  status: 200;
  body: AuthSessionResponse;
}

export async function emailConfirmHandler(
  request: EmailConfirmRequest,
  context: Service.Context<ApiProvider>
): Promise<EmailConfirmResponse> {
  await enforceQuota(context.db, `otp-confirm-ip:${trustedClientIp(request)}`, 60);
  try {
    const body = await confirmEmailAtomically(context.db, request.body, {
      accessTokenSecret: context.variables.AUTH_JWT_SECRET,
      codeHashKey: context.variables.LOGIN_CODE_HASH_KEY
    });
    return { status: 200, body };
  } catch (error) {
    if (error instanceof AuthFlowError) {
      throw new HttpUnauthorizedError();
    }
    throw error;
  }
}
