import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, isAvatarUpload } from './avatar';

describe('isAvatarUpload', () => {
  it('accepts JPEG and PNG up to 2 MB', () => {
    expect(isAvatarUpload('image/jpeg', 1)).toBe(true);
    expect(isAvatarUpload('image/png', AVATAR_MAX_BYTES)).toBe(true);
  });

  it('rejects other types, empty and oversized files', () => {
    expect(isAvatarUpload('image/webp', 10)).toBe(false);
    expect(isAvatarUpload('image/jpeg', 0)).toBe(false);
    expect(isAvatarUpload('image/jpeg', AVATAR_MAX_BYTES + 1)).toBe(false);
    expect(isAvatarUpload(undefined, 10)).toBe(false);
    expect(isAvatarUpload('image/png', undefined)).toBe(false);
  });
});
