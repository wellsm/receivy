import type { UserAvatar } from '@receivy/common';

const PREFIX = 'avatars/';

/** The one object a person's photo lives at; the version rides on `users.avatar_updated_at`. */
export function avatarKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/** Where an upload lands before `complete` validates and promotes it; never read for display. */
export function avatarStagingKey(userId: string): string {
  return `avatar-uploads/${userId}`;
}

/** Unsigned reference for a DTO: the object key stands in for the URL until the endpoint signs the body. */
export function avatarRef(userId: string, updatedAt: string | Date | null | undefined): UserAvatar | null {
  if (!updatedAt) {
    return null;
  }

  return { url: avatarKey(userId), version: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt };
}

export function isAvatarReference(value: Record<string, unknown>): value is UserAvatar {
  const keys = Object.keys(value);

  return keys.length === 2 && typeof value.version === 'string' && typeof value.url === 'string' && (value.url as string).startsWith(PREFIX);
}
