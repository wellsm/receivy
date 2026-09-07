import type { Service } from "@ez4/common";
import type { Http } from "@ez4/gateway";
import type { String } from "@ez4/schema";
import type { ProofDetail, ProofUploadIntent } from "@receivy/common";
import type { SessionIdentity } from "../authorizers/session";
import type { ApiProvider } from "../provider";
import { resolvePublicCharge } from "../public/repository";
import { configuredProofStorage } from "./configured-storage";
import { createUploadIntent, finalizeProof, listProofs, reviewProof, downloadProof, publicProofStatus } from "./repository";
import { throttleProof } from "./throttle";

declare class UploadRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID }; body: { filename: String.Size<1, 200>; mime: "image/jpeg" | "image/png" | "application/pdf"; size: number } }
declare class FinalizeRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID; intentId: String.UUID } }
declare class ListRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID } }
declare class ProofRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID; proofId: String.UUID } }
declare class ReviewRequest implements Http.Request { identity: SessionIdentity; parameters: { id: String.UUID; proofId: String.UUID }; body: { decision: "accepted" | "rejected"; reason?: String.Max<500> } }
declare class PublicUploadRequest implements Http.Request { parameters: { token: String.Max<200> }; body: { filename: String.Size<1, 200>; mime: "image/jpeg" | "image/png" | "application/pdf"; size: number } }
declare class PublicFinalizeRequest implements Http.Request { parameters: { token: String.Max<200>; intentId: String.UUID } }
declare class UploadResponse implements Http.Response { status: 200; body: ProofUploadIntent }
declare class ProofResponse implements Http.Response { status: 200; body: ProofDetail }
declare class ProofsResponse implements Http.Response { status: 200; body: { proofs: ProofDetail[] } }
declare class DownloadResponse implements Http.Response { status: 200; body: { url: string; expiresIn: number } }
declare class PublicFinalizeResponse implements Http.Response { status: 200; body: { state: "pending" } }
declare class PublicStatusResponse implements Http.Response { status: 200; body: { state: "pending" | "accepted" | "rejected"; reason: string | null; closureReason: "paid" | "cancelled" | null } }
export async function publicProofStatusHandler(request: PublicFinalizeRequest, context: Service.Context<ApiProvider>): Promise<PublicStatusResponse> {
  return { status: 200, body: await publicProofStatus(context.db, request.parameters.token, context.variables.PUBLIC_LINK_HMAC_SECRET, request.parameters.intentId) };
}

export async function uploadProofHandler(request: UploadRequest, context: Service.Context<ApiProvider>): Promise<UploadResponse> {
  await throttleProof(context.db, `user:${request.identity.userId}`);
  return { status: 200, body: await createUploadIntent(context.db, configuredProofStorage(context.variables), request.parameters.id, { userId: request.identity.userId }, request.body) };
}
export async function finalizeProofHandler(request: FinalizeRequest, context: Service.Context<ApiProvider>): Promise<ProofResponse> {
  await throttleProof(context.db, `user:${request.identity.userId}`);
  return { status: 200, body: await finalizeProof(context.db, configuredProofStorage(context.variables), request.parameters.id, { userId: request.identity.userId }, request.parameters.intentId) };
}
export async function listProofsHandler(request: ListRequest, context: Service.Context<ApiProvider>): Promise<ProofsResponse> {
  return { status: 200, body: { proofs: await listProofs(context.db, request.parameters.id, request.identity.userId) } };
}
export async function reviewProofHandler(request: ReviewRequest, context: Service.Context<ApiProvider>): Promise<ProofResponse> {
  return { status: 200, body: await reviewProof(context.db, request.parameters.id, request.identity.userId, request.parameters.proofId, request.body) };
}
export async function downloadProofHandler(request: ProofRequest, context: Service.Context<ApiProvider>): Promise<DownloadResponse> {
  return { status: 200, body: await downloadProof(context.db, configuredProofStorage(context.variables), request.parameters.id, request.identity.userId, request.parameters.proofId) };
}
export async function publicUploadProofHandler(request: PublicUploadRequest, context: Service.Context<ApiProvider>): Promise<UploadResponse> {
  await throttleProof(context.db, request.parameters.token);
  const secret = context.variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await resolvePublicCharge(context.db, request.parameters.token, secret);
  return { status: 200, body: await createUploadIntent(context.db, configuredProofStorage(context.variables), charge.id, { token: request.parameters.token, secret }, request.body) };
}
export async function publicFinalizeProofHandler(request: PublicFinalizeRequest, context: Service.Context<ApiProvider>): Promise<PublicFinalizeResponse> {
  await throttleProof(context.db, request.parameters.token);
  const secret = context.variables.PUBLIC_LINK_HMAC_SECRET;
  const charge = await resolvePublicCharge(context.db, request.parameters.token, secret);
  await finalizeProof(context.db, configuredProofStorage(context.variables), charge.id, { token: request.parameters.token, secret }, request.parameters.intentId);
  return { status: 200, body: { state: "pending" } };
}
