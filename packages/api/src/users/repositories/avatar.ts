import { HttpNotFoundError } from '@ez4/gateway';
import type { Client } from '@ez4/storage';
import { type AvatarMime, type AvatarUploadTicket, isAvatarUpload, type UserAvatar } from '@receivy/common';
import type { DbClient } from '../../database';
import { AvatarInvalidError } from '../errors';

const PREFIX = 'avatars/';
const UPLOAD_SECONDS = 300;
const READ_SECONDS = 3600;

function isReference(value: Record<string, unknown>): value is UserAvatar {
  const keys = Object.keys(value);

  return (
    keys.length === 2 && typeof value.version === 'string' && typeof value.url === 'string' && (value.url as string).startsWith(PREFIX)
  );
}

export namespace AvatarRepository {
  export function key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  /** Where an upload lands before `complete` validates and promotes it; never read for display. */
  export function stagingKey(userId: string): string {
    return `avatar-uploads/${userId}`;
  }

  /** Unsigned reference for a DTO: the object key stands in for the URL until the endpoint signs the body. */
  export function ref(userId: string, updatedAt: string | Date | null | undefined): UserAvatar | null {
    if (!updatedAt) {
      return null;
    }

    return { url: key(userId), version: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt };
  }

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

      if (isReference(record)) {
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
      uploadUrl: await bucket.getWriteUrl(stagingKey(userId), { expiresIn: UPLOAD_SECONDS, contentType: mime }),
      expiresAt: new Date(now.getTime() + UPLOAD_SECONDS * 1000).toISOString()
    };
  }

  /** Confirms the staged bytes are acceptable and promotes them; a bad upload never touches the published photo. */
  export async function complete(db: DbClient, bucket: Client, userId: string, now = new Date()): Promise<{ avatar: UserAvatar }> {
    const uploadKey = stagingKey(userId);
    const stats = await bucket.stat(uploadKey);

    if (!stats) {
      throw new HttpNotFoundError();
    }

    if (!isAvatarUpload(stats.type, stats.size)) {
      await bucket.delete(uploadKey);
      throw new AvatarInvalidError();
    }

    const user = await db.users.findOne({ select: { id: true }, where: { id: userId, deleted_at: { isNull: true } } });

    if (!user) {
      await bucket.delete(uploadKey);
      throw new HttpNotFoundError();
    }

    await bucket.copy(uploadKey, key(userId));
    await bucket.delete(uploadKey);

    const instant = now.toISOString();

    await db.users.updateOne({
      where: { id: userId },
      data: { avatar_updated_at: instant, updated_at: instant }
    });

    return sign(bucket, { avatar: ref(userId, instant)! });
  }
}
