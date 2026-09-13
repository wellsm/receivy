import type { Client } from '@ez4/storage';
import { AVATAR_MAX_BYTES } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarRepository } from '../repositories/avatar';

const TIMEOUT_MS = 3000;

type AdoptInput = {
  db: DbClient;
  bucket: Client;
  userId: string;
  picture: string | undefined;
  fetcher?: typeof fetch;
  now?: Date;
};

/**
 * Copies the OAuth provider's picture into `avatars/<id>` for a user who has no photo yet. Best effort: the login
 * that calls it must never fail because of the picture, so every problem ends in `false`.
 */
export async function adoptProviderPicture(
  { db, bucket, userId, picture, fetcher = fetch, now = new Date() }: AdoptInput
): Promise<boolean> {
  if (!picture?.startsWith('https://')) {
    return false;
  }

  try {
    const user = await db.users.findOne({
      select: { id: true, avatar_updated_at: true },
      where: { id: userId, deleted_at: { isNull: true } }
    });

    if (!user || user.avatar_updated_at) {
      return false;
    }

    const response = await fetcher(picture, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow'
    });
    if (!response.ok || (response.url && !response.url.startsWith('https://'))) {
      return false;
    }
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';

    if (!type.startsWith('image/')) {
      return false;
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (!bytes.length || bytes.length > AVATAR_MAX_BYTES) {
      return false;
    }

    const instant = now.toISOString();

    await bucket.write(AvatarRepository.key(userId), bytes, { contentType: type });
    await db.users.updateOne({
      where: { id: userId },
      data: { avatar_updated_at: instant, updated_at: instant }
    });

    return true;
  } catch {
    // Counts only: no URL, no user data.
    console.warn('Provider picture skipped');
    return false;
  }
}
