import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bound into the signature so a charge link can never be replayed as an invite link. */
export const enum PublicTokenPurpose {
  Charge = 'charge',
  Invite = 'invite',
  /** The footer link of a notice e-mail: it names the account that asked to stop hearing from us. */
  OptOut = 'opt-out',
  /** The path segment InfinitePay posts to: names the charge, never trusted for the money (payment_check does). */
  ProviderWebhook = 'provider_webhook'
}

type IssueInput = { publicId: string; expiresAtSeconds: number; secret: string; purpose: PublicTokenPurpose };
type VerifyInput = { nowSeconds?: number; secret: string; purpose: PublicTokenPurpose };

export function assertPublicLinkSecretConfigured(secret: string): string {
  if (!secret || secret === 'disabled') {
    throw new Error('Public link secret is not configured');
  }

  return secret;
}

function signature(purpose: PublicTokenPurpose, publicId: string, expires: number, secret: string): Buffer {
  return createHmac('sha256', assertPublicLinkSecretConfigured(secret)).update(`${purpose}.${publicId}.${expires}`).digest();
}

export function issuePublicChargeToken(input: IssueInput): string {
  const mac = signature(input.purpose, input.publicId, input.expiresAtSeconds, input.secret).toString('base64url');

  return `${input.publicId}.${input.expiresAtSeconds}.${mac}`;
}

function invalid(): never {
  throw new Error('Invalid public capability');
}

/** No expiry: the footer of an old e-mail must still work. Signed over the user id and the e-mail it was sent to, so a later address change retires the old link. */
function optOutSignature(userId: string, email: string, secret: string): Buffer {
  return createHmac('sha256', assertPublicLinkSecretConfigured(secret)).update(`${PublicTokenPurpose.OptOut}.${userId}.${email}`).digest();
}

export function issueOptOutToken(input: { userId: string; email: string; secret: string }): string {
  const mac = optOutSignature(input.userId, input.email, input.secret).toString('base64url');

  return `${input.userId}.${mac}`;
}

/** The caller resolves `userId` and the account's current `email` from the token's own id part before calling this. */
export function verifyOptOutToken(token: string, input: { userId: string; email: string; secret: string }): { userId: string } {
  const parts = token.split('.');
  const [userId, mac] = parts;

  if (parts.length !== 2 || !userId || !mac || userId !== input.userId) {
    invalid();
  }

  const expected = optOutSignature(input.userId, input.email, input.secret);
  const given = Buffer.from(mac, 'base64url');

  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    invalid();
  }

  return { userId };
}

export function verifyPublicChargeToken(token: string, input: VerifyInput): { publicId: string; expiresAtSeconds: number } {
  const [publicId, rawExpires, rawSignature, extra] = token.split('.');
  const expiresAtSeconds = Number(rawExpires);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!publicId || !rawExpires || !rawSignature || extra || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds) {
    invalid();
  }

  const expected = signature(input.purpose, publicId, expiresAtSeconds, input.secret);
  const actual = Buffer.from(rawSignature, 'base64url');

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    invalid();
  }

  return { publicId, expiresAtSeconds };
}
