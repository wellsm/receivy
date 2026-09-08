type PendingLogin = { email: string; sentAt: number };

let pending: PendingLogin | null = null;

/** Remembers the e-mail that just received a code and when it was sent (drives the expiry countdown). */
export function setPendingLoginEmail(email: string, sentAt = Date.now()): void {
  pending = { email, sentAt };
}

export function getPendingLoginEmail(): string | null {
  return pending?.email ?? null;
}

export function getPendingLoginSentAt(): number | null {
  return pending?.sentAt ?? null;
}

export function clearPendingLoginEmail(): void {
  pending = null;
}
