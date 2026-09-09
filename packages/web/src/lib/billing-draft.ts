import type { BillingDraft } from "@receivy/common";

const KEY = "receivy.billingDraft";
const PIX_REQUIRED_KEY = "receivy.pixRequiredSeen";

export type StoredDraft = { draft: BillingDraft; returnTo: string };

/**
 * The quick billing form leaves the page to register a contact or a Pix key, so
 * the half-filled draft rides along in `sessionStorage`: it survives the
 * navigation, dies with the tab and never reaches the server. Every access is
 * guarded because private windows and blocked site data make storage throw.
 */
function read(): StoredDraft | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredDraft>;

    if (!parsed || typeof parsed !== "object" || !parsed.draft || typeof parsed.returnTo !== "string") {
      return null;
    }

    return { draft: parsed.draft, returnTo: parsed.returnTo };
  } catch {
    return null;
  }
}

function write(stored: StoredDraft): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage is unavailable; the draft is simply not restored on return.
  }
}

export function saveDraft(draft: BillingDraft, returnTo: string): void {
  write({ draft, returnTo });
}

/** Reads the stored draft and clears it, so a restore never happens twice. */
export function takeDraft(): StoredDraft | null {
  const stored = read();

  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }

  return stored;
}

/** Merges the result of a side trip (a new contact, a new Pix key) into the draft. */
export function patchDraft(patch: { selected?: string[]; pix?: string }): void {
  const stored = read();

  if (!stored) {
    return;
  }

  const selected = patch.selected ? [...new Set([...stored.draft.selected, ...patch.selected])] : stored.draft.selected;
  const pix = patch.pix === undefined ? {} : { pix: patch.pix };

  write({ returnTo: stored.returnTo, draft: { ...stored.draft, selected, ...pix } });
}

/**
 * The billing form pushes the Pix key screen the first time an account without a
 * key opens it. The trip is remembered for the tab so the return visit shows the
 * blocking panel instead of bouncing the user out again; registering a key clears
 * it, and the flag dies with the session like the draft itself.
 */
export function pixRequiredSeen(): boolean {
  try {
    return window.sessionStorage.getItem(PIX_REQUIRED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPixRequiredSeen(): void {
  try {
    window.sessionStorage.setItem(PIX_REQUIRED_KEY, "1");
  } catch {
    // Storage is unavailable; the gate simply pushes again on the next mount.
  }
}

export function clearPixRequiredSeen(): void {
  try {
    window.sessionStorage.removeItem(PIX_REQUIRED_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
