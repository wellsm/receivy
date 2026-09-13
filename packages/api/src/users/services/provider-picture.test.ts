import type { Client } from '@ez4/storage';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../../database';
import { adoptProviderPicture } from './provider-picture';

function fakes(avatarUpdatedAt?: string) {
  const db = {
    users: {
      findOne: vi.fn(async () => ({ id: 'u1', avatar_updated_at: avatarUpdatedAt })),
      updateOne: vi.fn(async () => undefined)
    }
  } as unknown as DbClient;
  const bucket = { write: vi.fn(async () => undefined) } as unknown as Client;

  return { db, bucket };
}

function image(type = 'image/jpeg', bytes = 10, url = 'https://lh3.test/p.jpg') {
  return vi.fn(async () => {
    const response = new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { 'content-type': type }
    });
    Object.defineProperty(response, 'url', { value: url, writable: false });
    return response;
  }) as unknown as typeof fetch;
}

describe('adoptProviderPicture', () => {
  it('stores the picture for a user without photo', async () => {
    const { db, bucket } = fakes();
    const now = new Date('2026-01-01T12:00:00.000Z');
    const instant = '2026-01-01T12:00:00.000Z';
    const stored = await adoptProviderPicture({
      db,
      bucket,
      userId: 'u1',
      picture: 'https://lh3.test/p.jpg',
      fetcher: image(),
      now
    });

    expect(stored).toBe(true);
    expect(bucket.write).toHaveBeenCalledWith('avatars/u1', expect.any(Buffer), { contentType: 'image/jpeg' });
    expect(db.users.updateOne).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatar_updated_at: instant, updated_at: instant }
    });
  });

  it('never replaces an existing photo', async () => {
    const { db, bucket } = fakes('2026-01-01T00:00:00.000Z');
    const fetcher = image();

    expect(await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'https://lh3.test/p.jpg', fetcher })).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('ignores missing, insecure, non-image, oversized and failing pictures', async () => {
    const { db, bucket } = fakes();

    expect(
      await adoptProviderPicture({ db, bucket, userId: 'u1', picture: undefined, fetcher: image() })
    ).toBe(false);
    expect(
      await adoptProviderPicture({ db, bucket, userId: 'u1', picture: 'http://lh3.test/p.jpg', fetcher: image() })
    ).toBe(false);
    expect(
      await adoptProviderPicture({
        db,
        bucket,
        userId: 'u1',
        picture: 'https://lh3.test/p',
        fetcher: image('text/html')
      })
    ).toBe(false);
    expect(
      await adoptProviderPicture({
        db,
        bucket,
        userId: 'u1',
        picture: 'https://lh3.test/p',
        fetcher: image('image/png', 3 * 1024 * 1024)
      })
    ).toBe(false);
    expect(
      await adoptProviderPicture({
        db,
        bucket,
        userId: 'u1',
        picture: 'https://lh3.test/p',
        fetcher: image('image/jpeg', 10, 'http://lh3.test/p.jpg')
      })
    ).toBe(false);
    expect(
      await adoptProviderPicture({
        db,
        bucket,
        userId: 'u1',
        picture: 'https://lh3.test/p',
        fetcher: vi.fn(async () => {
          throw new Error('down');
        }) as unknown as typeof fetch
      })
    ).toBe(false);
    expect(bucket.write).not.toHaveBeenCalled();
  });
});
