import type { BillingDraft } from "@receivy/common";

/**
 * The quick billing form leaves the screen to register a contact or a Pix key,
 * so the half-filled draft waits here in memory: it survives the navigation,
 * dies with the process and never reaches the server.
 */
let parked: BillingDraft | null = null;

/**
 * The billing form pushes the Pix key screen the first time an account without a
 * key opens it. The trip is remembered so the return visit shows the blocking
 * panel instead of bouncing the user out again; registering a key clears it, and
 * so does leaving the form.
 */

export function saveDraft(draft: BillingDraft): void {
  parked = draft;
}

/** Reads the parked draft and clears it, so a restore never happens twice. */
export function takeDraft(): BillingDraft | null {
  const draft = parked;

  parked = null;

  return draft;
}

/** A conta a receber splits between everyone; a registro a receber has a single payer, so the newcomer takes the seat. */
function selectedWith(draft: BillingDraft, userId: string): string[] {
  if (draft.settled) {
    return [userId];
  }

  return [...new Set([...draft.selected, userId])];
}

/**
 * Merges the result of a side trip (a new contact, a new Pix key) into the parked draft.
 * A conta a pagar has a single receiving contact, so a contact created from it takes that seat by
 * its agenda entry (`contact.id`) instead of joining the participants, who are seated by account.
 */
export function patchDraft(patch: { contact?: { id: string; userId: string }; pix?: string }): void {
  if (!parked) {
    return;
  }

  const pix = patch.pix === undefined ? {} : { pix: patch.pix };

  if (parked.direction === "payable") {
    parked = { ...parked, ...(patch.contact ? { payee: patch.contact.id } : {}), ...pix };

    return;
  }

  const selected = patch.contact ? selectedWith(parked, patch.contact.userId) : parked.selected;

  parked = { ...parked, selected, ...pix };
}

export function clearDraft(): void {
  parked = null;
}
