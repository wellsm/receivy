export const PENDING_LOGIN_KEY = "receivy.pendingLogin";

export type PendingLogin = {
  email: string;
  sentAt: number;
  nextPath: string;
};

export function readPendingLogin(): PendingLogin | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LOGIN_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingLogin>;

    if (typeof parsed.email !== "string" || typeof parsed.sentAt !== "number" || typeof parsed.nextPath !== "string") {
      return null;
    }

    return { email: parsed.email, sentAt: parsed.sentAt, nextPath: parsed.nextPath };
  } catch {
    return null;
  }
}

export function writePendingLogin(pending: PendingLogin): void {
  try {
    sessionStorage.setItem(PENDING_LOGIN_KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage may be unavailable (private mode); the code screen
    // simply redirects back to /login if it cannot read the pending login.
  }
}
