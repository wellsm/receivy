import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bound into the signature so a charge link can never be replayed as an invite link. */
export const enum PublicTokenPurpose {
  Charge = 'charge',
  Invite = 'invite'
}

type IssueInput = { publicId: string; expiresAtSeconds: number; secret: string; purpose: PublicTokenPurpose };
type VerifyInput = { nowSeconds?: number; secret: string; purpose: PublicTokenPurpose };

export function assertPublicLinkSecretConfigured(secret: string): string {
  if (!secret || secret === 'disabled') throw new Error('Public link secret is not configured');
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

export function verifyPublicChargeToken(token: string, input: VerifyInput): { publicId: string; expiresAtSeconds: number } {
  const [publicId, rawExpires, rawSignature, extra] = token.split('.');
  const expiresAtSeconds = Number(rawExpires);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!publicId || !rawExpires || !rawSignature || extra || !Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds <= nowSeconds)
    invalid();
  const expected = signature(input.purpose, publicId, expiresAtSeconds, input.secret);
  const actual = Buffer.from(rawSignature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalid();
  return { publicId, expiresAtSeconds };
}
