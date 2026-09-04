let pendingEmail: string | null = null;

export function setPendingLoginEmail(email: string): void {
  pendingEmail = email;
}

export function getPendingLoginEmail(): string | null {
  return pendingEmail;
}

export function clearPendingLoginEmail(): void {
  pendingEmail = null;
}
