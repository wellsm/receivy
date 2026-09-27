import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicProvider } from '../provider';

declare class OptOutLinkRequest implements Http.Request {
  parameters: { code: String.Max<16> };
}

declare class OptOutLinkResponse implements Http.Response {
  status: 200;
  body: { token: string };
}

/** `/o/<code>` asks here for the footer token, then opens `/opt-out/<token>`. */
export async function optOutLinkHandler({ parameters }: OptOutLinkRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<OptOutLinkResponse> {
  return { status: 200, body: await publicLinks.optOutLink(parameters.code) };
}
