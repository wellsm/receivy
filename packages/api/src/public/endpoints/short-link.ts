import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { PublicLink } from '@receivy/common';
import type { PublicProvider } from '../provider';

declare class ShortLinkRequest implements Http.Request {
  parameters: { code: String.Max<16> };
}

declare class ShortLinkResponse implements Http.Response {
  status: 200;
  body: PublicLink;
}

/** `/p/<code>` asks here for the signed token, then opens `/pay/<token>`. */
export async function shortLinkHandler({ parameters }: ShortLinkRequest, { publicLinks }: Service.Context<PublicProvider>): Promise<ShortLinkResponse> {
  return { status: 200, body: await publicLinks.shortLink(parameters.code) };
}
