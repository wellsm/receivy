import type { BillingDraft } from "@receivy/common";

const KEY = "receivy.billingDraft";

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

/** A conta a receber splits between everyone; a registro a receber has a single payer, so the newcomer takes the seat. */
function selectedWith(draft: BillingDraft, userId: string): string[] {
  if (draft.settled) {
    return [userId];
  }

  return [...new Set([...draft.selected, userId])];
}

/**
 * Merges the result of a side trip (a new contact, a new Pix key) into the draft.
 * A conta a pagar has no participants: the contact created on the way takes the receiving seat,
 * which holds the agenda entry itself (`contact.id`), not the account behind it.
 */
export function patchDraft(patch: { contact?: { id: string; userId: string }; pix?: string }): void {
  const stored = read();

  if (!stored) {
    return;
  }

  const pix = patch.pix === undefined ? {} : { pix: patch.pix };

  if (stored.draft.direction === "payable") {
    const payee = patch.contact ? { payee: patch.contact.id } : {};

    write({ returnTo: stored.returnTo, draft: { ...stored.draft, ...payee, ...pix } });
    return;
  }

  const selected = patch.contact ? selectedWith(stored.draft, patch.contact.userId) : stored.draft.selected;

  write({ returnTo: stored.returnTo, draft: { ...stored.draft, selected, ...pix } });
}
