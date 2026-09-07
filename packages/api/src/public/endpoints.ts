import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { PublicChargeView, PublicLink } from "@receivy/common";
import type { SessionIdentity } from "../authorizers/session";
import type { ApiProvider } from "../provider";
import { createOrRotatePublicLink, getPublicCharge, revokePublicLink } from "./repository";

declare class ChargeRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID } }
declare class TokenRequest implements Http.Request { parameters: { token: String.Max<200> } }
declare class LinkResponse implements Http.Response { status: 200; body: PublicLink }
declare class EmptyResponse implements Http.Response { status: 204 }
declare class PublicResponse implements Http.Response { status: 200; body: PublicChargeView }

export async function createPublicLinkHandler(request: ChargeRequest, context: Service.Context<ApiProvider>): Promise<LinkResponse> {
  return { status: 200, body: await createOrRotatePublicLink(context.db, request.identity.userId, request.parameters.id,
    context.variables.PUBLIC_LINK_HMAC_SECRET) };
}
export async function rotatePublicLinkHandler(request: ChargeRequest, context: Service.Context<ApiProvider>): Promise<LinkResponse> {
  return { status: 200, body: await createOrRotatePublicLink(context.db, request.identity.userId, request.parameters.id,
    context.variables.PUBLIC_LINK_HMAC_SECRET, true) };
}
export async function revokePublicLinkHandler(request: ChargeRequest, context: Service.Context<ApiProvider>): Promise<EmptyResponse> {
  await revokePublicLink(context.db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
export async function publicChargeHandler(request: TokenRequest, context: Service.Context<ApiProvider>): Promise<PublicResponse> {
  return { status: 200, body: await getPublicCharge(context.db, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET) };
}
