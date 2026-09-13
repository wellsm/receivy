/**
 * A person's photo. The API fills `url` with a short-lived signed URL; `version` changes only when the photo
 * does, so clients key their image cache on it instead of on the URL.
 */
export type UserAvatar = { url: string; version: string };

export const enum AvatarMime {
  Jpeg = 'image/jpeg',
  Png = 'image/png'
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_INVALID_MESSAGE = 'Envie uma imagem JPG ou PNG de até 2 MB.';

export type AvatarUploadTicket = { uploadUrl: string; expiresAt: string };

export function isAvatarUpload(mime: string | null | undefined, size: number | null | undefined): boolean {
  if (mime !== AvatarMime.Jpeg && mime !== AvatarMime.Png) {
    return false;
  }

  return typeof size === 'number' && size > 0 && size <= AVATAR_MAX_BYTES;
}
