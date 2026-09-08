import { describe, expect, it } from 'vitest';
import { issuePublicChargeToken, verifyPublicChargeToken } from './capability';

const secret = 'test-capability-secret-that-is-not-used-outside-tests';
const publicId = 'w2OT1RsBRwcc0SDRB8-PJw';

describe('public charge capability', () => {
  it('binds public id, expiration and stored version', () => {
    const token = issuePublicChargeToken({ publicId, version: 3, expiresAtSeconds: 2_000, secret });
    expect(verifyPublicChargeToken(token, { version: 3, nowSeconds: 1_999, secret })).toEqual({ publicId, expiresAtSeconds: 2_000 });
    expect(() => verifyPublicChargeToken(token, { version: 4, nowSeconds: 1_999, secret })).toThrow('Invalid public capability');
  });

  it('expires at the encoded second and rejects tampering', () => {
    const token = issuePublicChargeToken({ publicId, version: 1, expiresAtSeconds: 2_000, secret });
    expect(() => verifyPublicChargeToken(token, { version: 1, nowSeconds: 2_000, secret })).toThrow('Invalid public capability');
    expect(() => verifyPublicChargeToken(`${token}x`, { version: 1, nowSeconds: 1_000, secret })).toThrow('Invalid public capability');
  });

  it('requires an explicitly configured secret', () => {
    expect(() => issuePublicChargeToken({ publicId, version: 1, expiresAtSeconds: 2_000, secret: '' })).toThrow(
      'Public link secret is not configured'
    );
    expect(() => issuePublicChargeToken({ publicId, version: 1, expiresAtSeconds: 2_000, secret: 'disabled' })).toThrow(
      'Public link secret is not configured'
    );
  });
});
