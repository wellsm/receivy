import type { Client } from '@ez4/storage';
import { isAvatarUpload } from '@receivy/common';
import type { DbClient } from '../../database';
import { AccountRepository } from '../repositories/account';
import { avatarKey } from '../utils/avatar';

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
export async function adoptProviderPicture({
  db,
  bucket,
  userId,
  picture,
  fetcher = fetch,
  now = new Date()
}: AdoptInput): Promise<boolean> {
  if (!picture?.startsWith('https://')) {
    return false;
  }

  try {
    const user = await AccountRepository.avatarUpdatedAt(db, userId);

    if (!user || user.avatarUpdatedAt) {
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
    const bytes = Buffer.from(await response.arrayBuffer());

    if (!isAvatarUpload(type, bytes.length)) {
      return false;
    }

    const instant = now.toISOString();

    await bucket.write(avatarKey(userId), bytes, { contentType: type });
    await AccountRepository.touchAvatar(db, userId, instant);

    return true;
  } catch {
    // Counts only: no URL, no user data.
    console.warn('Provider picture skipped');

    return false;
  }
}
