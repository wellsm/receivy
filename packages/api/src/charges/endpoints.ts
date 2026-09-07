import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { ChargeDetail } from "@receivy/common";
import type { SessionIdentity } from "../authorizers/session";
import type { ApiProvider } from "../provider";
import { cancelCharge, getCharge, recordManualPayment } from "./repository";

declare class IdRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID } }
declare class PayRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID }; body: {
  method: "pix" | "cash" | "transfer" | "other"; paidAt?: String.DateTime;
} }
declare class ItemResponse implements Http.Response { status: 200; body: ChargeDetail }

export async function getChargeHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<ItemResponse> {
  return { status: 200, body: await getCharge(context.db, request.identity.userId, request.parameters.id) };
}
export async function cancelChargeHandler(request: IdRequest, context: Service.Context<ApiProvider>): Promise<ItemResponse> {
  return { status: 200, body: await cancelCharge(context.db, request.identity.userId, request.parameters.id) };
}
export async function manualPaymentHandler(request: PayRequest, context: Service.Context<ApiProvider>): Promise<ItemResponse> {
  return { status: 200, body: await recordManualPayment(context.db, request.identity.userId, request.parameters.id, request.body) };
}
