import { describe, expect, it } from 'vitest';
import { issuePublicChargeToken, PublicTokenPurpose, verifyPublicChargeToken } from './capability';

const secret = 'test-capability-secret-that-is-not-used-outside-tests';
const publicId = 'w2OT1RsBRwcc0SDRB8-PJw';

describe('public charge capability', () => {
  it('binds the public id and the expiration', () => {
    const token = issuePublicChargeToken({ publicId, expiresAtSeconds: 2_000, secret, purpose: PublicTokenPurpose.Charge });
    expect(verifyPublicChargeToken(token, { nowSeconds: 1_999, secret, purpose: PublicTokenPurpose.Charge })).toEqual({
      publicId,
      expiresAtSeconds: 2_000
    });
    // The handle is signed along with the deadline: pointing the token at another one cannot be re-signed.
    const [, expires, mac] = token.split('.');
    expect(() =>
      verifyPublicChargeToken(`other.${expires}.${mac}`, { nowSeconds: 1_999, secret, purpose: PublicTokenPurpose.Charge })
    ).toThrow('Invalid public capability');
  });

  it('keeps charge and invite capabilities apart', () => {
    const token = issuePublicChargeToken({ publicId, expiresAtSeconds: 2_000, secret, purpose: PublicTokenPurpose.Invite });
    expect(verifyPublicChargeToken(token, { nowSeconds: 1_999, secret, purpose: PublicTokenPurpose.Invite })).toEqual({
      publicId,
      expiresAtSeconds: 2_000
    });
    expect(() => verifyPublicChargeToken(token, { nowSeconds: 1_999, secret, purpose: PublicTokenPurpose.Charge })).toThrow(
      'Invalid public capability'
    );
  });

  it('expires at the encoded second and rejects tampering', () => {
    const token = issuePublicChargeToken({ publicId, expiresAtSeconds: 2_000, secret, purpose: PublicTokenPurpose.Charge });
    expect(() => verifyPublicChargeToken(token, { nowSeconds: 2_000, secret, purpose: PublicTokenPurpose.Charge })).toThrow(
      'Invalid public capability'
    );
    expect(() => verifyPublicChargeToken(`${token}x`, { nowSeconds: 1_000, secret, purpose: PublicTokenPurpose.Charge })).toThrow(
      'Invalid public capability'
    );
  });

  it('requires an explicitly configured secret', () => {
    expect(() => issuePublicChargeToken({ publicId, expiresAtSeconds: 2_000, secret: '', purpose: PublicTokenPurpose.Charge })).toThrow(
      'Public link secret is not configured'
    );
    expect(() =>
      issuePublicChargeToken({ publicId, expiresAtSeconds: 2_000, secret: 'disabled', purpose: PublicTokenPurpose.Charge })
    ).toThrow('Public link secret is not configured');
  });
});
