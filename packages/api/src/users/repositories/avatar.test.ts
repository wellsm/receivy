import type { Client } from '@ez4/storage';
import { describe, expect, it, vi } from 'vitest';
import { AvatarRepository } from './avatar';
import { avatarRef } from '../utils/avatar';

function bucket() {
  return {
    getReadUrl: vi.fn(async (key: string) => `https://bucket.test/${key}?signed`)
  } as unknown as Client;
}

describe('avatarRef', () => {
  it('references the object only when a photo exists', () => {
    expect(avatarRef('u1', null)).toBeNull();
    expect(avatarRef('u1', '2026-09-13T10:00:00.000Z')).toEqual({ url: 'avatars/u1', version: '2026-09-13T10:00:00.000Z' });
    expect(avatarRef('u1', new Date('2026-09-13T10:00:00.000Z'))?.version).toBe('2026-09-13T10:00:00.000Z');
  });
});

describe('AvatarRepository.sign', () => {
  it('signs every reference in a nested body once per key', async () => {
    const client = bucket();
    const body = {
      items: [
        { charge: { counterpartAvatar: avatarRef('u1', '2026-01-01T00:00:00.000Z') } },
        { charge: { counterpartAvatar: avatarRef('u1', '2026-01-01T00:00:00.000Z') } }
      ],
      recipient: { name: 'Ana', avatar: avatarRef('u2', '2026-01-02T00:00:00.000Z') },
      other: { url: 'https://example.test', version: 'x' },
      empty: null
    };

    const signed = await AvatarRepository.sign(client, body);

    expect(signed.items[0]!.charge.counterpartAvatar?.url).toBe('https://bucket.test/avatars/u1?signed');
    expect(signed.recipient.avatar).toEqual({ url: 'https://bucket.test/avatars/u2?signed', version: '2026-01-02T00:00:00.000Z' });
    expect(signed.other.url).toBe('https://example.test');
    expect(client.getReadUrl).toHaveBeenCalledTimes(2);
    expect(client.getReadUrl).toHaveBeenCalledWith('avatars/u1', { expiresIn: 3600 });
  });
});
