import { describe, expect, it } from 'vitest';
import { issueOptOutToken, issuePublicChargeToken, PublicTokenPurpose, verifyOptOutToken, verifyPublicChargeToken } from './capability';

const secret = 'test-capability-secret-that-is-not-used-outside-tests';
const publicId = 'w2OT1RsBRwcc0SDRB8-PJw';
const userId = 'b1111111-1111-4111-8111-111111111111';
const email = 'opt-out-target@example.com';

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

describe('opt-out capability', () => {
  it('round-trips the signed user id and e-mail', () => {
    const token = issueOptOutToken({ userId, email, secret });

    expect(verifyOptOutToken(token, { userId, email, secret })).toEqual({ userId });
  });

  it('rejects a token signed with another secret', () => {
    const token = issueOptOutToken({ userId, email, secret });

    expect(() => verifyOptOutToken(token, { userId, email, secret: 'another-secret-that-is-not-used-outside-tests' })).toThrow(
      'Invalid public capability'
    );
  });

  it('rejects the token once the account e-mail has changed', () => {
    const token = issueOptOutToken({ userId, email, secret });

    expect(() => verifyOptOutToken(token, { userId, email: 'someone-else@example.com', secret })).toThrow('Invalid public capability');
  });

  it('rejects a token with extra segments', () => {
    const token = issueOptOutToken({ userId, email, secret });

    expect(() => verifyOptOutToken(`${token}.extra`, { userId, email, secret })).toThrow('Invalid public capability');
  });

  it('rejects a malformed token', () => {
    expect(() => verifyOptOutToken(userId, { userId, email, secret })).toThrow('Invalid public capability');
    expect(() => verifyOptOutToken('', { userId, email, secret })).toThrow('Invalid public capability');
  });
});
