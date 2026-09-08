import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthUser } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { createExportTicket, downloadExport, eraseAccount, listSessions, revokeSession, updateProfile } from './repository';

declare class Request implements Http.Request {
  identity: SessionIdentity;
}
declare class ProfileRequest implements Http.Request {
  identity: SessionIdentity;
  body: { name: String.Max<120>; locale: 'pt-BR'; timezone: String.Max<64>; country: 'BR' };
}
declare class RevokeRequest implements Http.Request {
  identity: SessionIdentity;
  parameters: { id: String.UUID };
}
declare class DeleteRequest implements Http.Request {
  identity: SessionIdentity;
  body: { confirmation: String.Max<20> };
}
declare class DownloadRequest implements Http.Request {
  identity: SessionIdentity;
  body: { token: String.Max<300> };
}
declare class ProfileResponse implements Http.Response {
  status: 200;
  body: { user: AuthUser };
}
declare class SessionsResponse implements Http.Response {
  status: 200;
  body: { sessions: { id: string; deviceName: string; createdAt: string; lastSeenAt: string; current: boolean }[] };
}
declare class EmptyResponse implements Http.Response {
  status: 204;
}
declare class DeleteResponse implements Http.Response {
  status: 200;
  body: { deleted: boolean; providerRevocation: 'not_required' | 'pending' | 'manual_action_required' | 'unknown' };
}
declare class TicketResponse implements Http.Response {
  status: 200;
  body: { token: string; expiresAt: string };
}
declare class DownloadResponse implements Http.Response {
  status: 200;
  headers: { 'cache-control': string };
  body: { filename: string; json: string };
}
export async function profileHandler(request: ProfileRequest, context: Service.Context<ApiProvider>): Promise<ProfileResponse> {
  return { status: 200, body: { user: await updateProfile(context.db, request.identity.userId, request.body) } };
}
export async function sessionsHandler(request: Request, context: Service.Context<ApiProvider>): Promise<SessionsResponse> {
  return { status: 200, body: { sessions: await listSessions(context.db, request.identity.userId, request.identity.familyId) } };
}
export async function revokeHandler(request: RevokeRequest, context: Service.Context<ApiProvider>): Promise<EmptyResponse> {
  await revokeSession(context.db, request.identity.userId, request.parameters.id);
  return { status: 204 };
}
export async function deleteHandler(request: DeleteRequest, context: Service.Context<ApiProvider>): Promise<DeleteResponse> {
  return { status: 200, body: await eraseAccount(context.db, request.identity.userId, request.body.confirmation) };
}
export async function exportHandler(request: Request, context: Service.Context<ApiProvider>): Promise<TicketResponse> {
  return { status: 200, body: await createExportTicket(context.db, request.identity, context.variables.AUTH_JWT_SECRET) };
}
export async function downloadHandler(request: DownloadRequest, context: Service.Context<ApiProvider>): Promise<DownloadResponse> {
  return {
    status: 200,
    headers: { 'cache-control': 'private, no-store' },
    body: await downloadExport(context.db, request.identity, request.body.token, context.variables.AUTH_JWT_SECRET)
  };
}
