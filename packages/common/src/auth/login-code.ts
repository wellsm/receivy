/** Server-side lifetime of an e-mail login code (see api `auth/email-login`). */
export const LOGIN_CODE_TTL_MS = 10 * 60_000;

/** Server-side cooldown between two code requests for the same e-mail. */
export const RESEND_COOLDOWN_MS = 60_000;

/** Hides most of the local part so a shoulder surfer cannot read the address on the code screen. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');

  if (at <= 0) {
    return email;
  }

  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 3);

  return `${visible}***${email.slice(at)}`;
}

/** `mm:ss` countdown text; partial seconds round up so the display never reads 00:00 while time remains. */
export function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
