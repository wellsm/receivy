import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

type RandomInteger = (min: number, max: number) => number;

type EmailCodeHashInput = {
  code: string;
  normalizedEmail: string;
  secret: string;
};

type EmailCodeVerificationInput = EmailCodeHashInput & {
  codeHash: string;
};

type EmailCodeState = {
  attempts: number;
  consumedAt: Date | null;
  expiresAt: Date;
};

export function generateEmailCode(
  randomInteger: RandomInteger = randomInt,
): string {
  return randomInteger(0, 1_000_000).toString().padStart(6, "0");
}

export function createEmailCodeHash({
  code,
  normalizedEmail,
  secret,
}: EmailCodeHashInput): string {
  return createHmac("sha256", secret)
    .update(normalizedEmail)
    .update("\0")
    .update(code)
    .digest("base64url");
}

export function verifyEmailCodeHash({
  codeHash,
  ...input
}: EmailCodeVerificationInput): boolean {
  const actual = Buffer.from(createEmailCodeHash(input));
  const expected = Buffer.from(codeHash);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function canAttemptEmailCode(
  state: EmailCodeState,
  now = new Date(),
): boolean {
  return (
    state.consumedAt === null &&
    state.attempts < 5 &&
    state.expiresAt.getTime() > now.getTime()
  );
}
