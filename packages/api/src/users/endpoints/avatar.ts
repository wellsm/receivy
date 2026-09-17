import type { Service } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { AvatarMime, AvatarUploadTicket, UserAvatar } from '@receivy/common';
import type { SessionIdentity } from '../../common/authorizers/session';
import type { UserProvider } from '../provider';
import { AvatarRepository } from '../repositories/avatar';

declare class AvatarUploadRequest implements Http.Request {
  identity: SessionIdentity;
  body: { mime: AvatarMime };
}

declare class AvatarUploadResponse implements Http.Response {
  status: 200;
  body: AvatarUploadTicket;
}

declare class AvatarCompleteRequest implements Http.Request {
  identity: SessionIdentity;
}

declare class AvatarCompleteResponse implements Http.Response {
  status: 200;
  body: { avatar: UserAvatar };
}

export async function startAvatarUploadHandler(
  request: AvatarUploadRequest,
  { avatarFiles }: Service.Context<UserProvider>
): Promise<AvatarUploadResponse> {
  return { status: 200, body: await AvatarRepository.startUpload(avatarFiles, request.identity.userId, request.body.mime) };
}

export async function completeAvatarUploadHandler(
  request: AvatarCompleteRequest,
  { db, avatarFiles }: Service.Context<UserProvider>
): Promise<AvatarCompleteResponse> {
  return { status: 200, body: await AvatarRepository.complete(db, avatarFiles, request.identity.userId) };
}
