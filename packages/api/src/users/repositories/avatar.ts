import { HttpNotFoundError } from '@ez4/gateway';
import type { Client } from '@ez4/storage';
import { type AvatarMime, type AvatarUploadTicket, isAvatarUpload, type UserAvatar } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarInvalidError } from '../errors';
import { AccountRepository } from './account';
import { avatarKey, avatarRef, avatarStagingKey, isAvatarReference } from '../utils/avatar';

const UPLOAD_SECONDS = 300;
const READ_SECONDS = 3600;

export namespace AvatarRepository {
  /** Replaces every avatar reference in `body` with a signed read URL; one signature per object key. */
  export async function sign<T>(bucket: Client, body: T): Promise<T> {
    const urls = new Map<string, Promise<string>>();

    async function visit(value: unknown): Promise<void> {
      if (!value || typeof value !== 'object') {
        return;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          await visit(item);
        }

        return;
      }

      const record = value as Record<string, unknown>;

      if (isAvatarReference(record)) {
        const objectKey = record.url;

        if (!urls.has(objectKey)) {
          urls.set(objectKey, bucket.getReadUrl(objectKey, { expiresIn: READ_SECONDS }));
        }

        record.url = await urls.get(objectKey)!;

        return;
      }

      for (const child of Object.values(record)) {
        await visit(child);
      }
    }

    await visit(body);

    return body;
  }

  export async function startUpload(bucket: Client, userId: string, mime: AvatarMime, now = new Date()): Promise<AvatarUploadTicket> {
    if (!isAvatarUpload(mime, 1)) {
      throw new AvatarInvalidError();
    }

    return {
      uploadUrl: await bucket.getWriteUrl(avatarStagingKey(userId), { expiresIn: UPLOAD_SECONDS, contentType: mime }),
      expiresAt: new Date(now.getTime() + UPLOAD_SECONDS * 1000).toISOString()
    };
  }

  /** Confirms the staged bytes are acceptable and promotes them; a bad upload never touches the published photo. */
  export async function complete(db: DbClient, bucket: Client, userId: string, now = new Date()): Promise<{ avatar: UserAvatar }> {
    const uploadKey = avatarStagingKey(userId);
    const stats = await bucket.stat(uploadKey);

    if (!stats) {
      throw new HttpNotFoundError();
    }

    if (!isAvatarUpload(stats.type, stats.size)) {
      await bucket.delete(uploadKey);

      throw new AvatarInvalidError();
    }

    if (!(await AccountRepository.isLive(db, userId))) {
      await bucket.delete(uploadKey);

      throw new HttpNotFoundError();
    }

    await bucket.copy(uploadKey, avatarKey(userId));
    await bucket.delete(uploadKey);

    const instant = now.toISOString();

    await AccountRepository.touchAvatar(db, userId, instant);

    return sign(bucket, { avatar: avatarRef(userId, instant)! });
  }
}
