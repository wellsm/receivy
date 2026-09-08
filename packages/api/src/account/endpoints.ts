import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { AuthUser } from '@receivy/common';
import type { SessionIdentity } from '../authorizers/session';
import type { ApiProvider } from '../provider';
import { eraseAccount, updateProfile } from './repository';

declare class ProfileRequest implements Http.Request {
  identity: SessionIdentity;
  body: { name: String.Max<120>; locale: 'pt-BR'; timezone: String.Max<64>; country: 'BR' };
}
declare class DeleteRequest implements Http.Request {
  identity: SessionIdentity;
  body: { confirmation: String.Max<20> };
}
declare class ProfileResponse implements Http.Response {
  status: 200;
  body: { user: AuthUser };
}
declare class DeleteResponse implements Http.Response {
  status: 200;
  body: { deleted: boolean; providerRevocation: 'not_required' | 'pending' | 'manual_action_required' | 'unknown' };
}
export async function profileHandler(request: ProfileRequest, context: Service.Context<ApiProvider>): Promise<ProfileResponse> {
  return { status: 200, body: { user: await updateProfile(context.db, request.identity.userId, request.body) } };
}
export async function deleteHandler(request: DeleteRequest, context: Service.Context<ApiProvider>): Promise<DeleteResponse> {
  return { status: 200, body: await eraseAccount(context.db, request.identity.userId, request.body.confirmation) };
}
