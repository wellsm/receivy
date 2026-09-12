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

/**
 * Merges the result of a side trip (a new contact, a new Pix key) into the parked draft.
 * A conta a pagar has a single payee, so a contact created from it takes that seat
 * instead of joining the participants.
 */
export function patchDraft(patch: { selected?: string[]; pix?: string }): void {
  if (!parked) {
    return;
  }

  const pix = patch.pix === undefined ? {} : { pix: patch.pix };

  if (parked.direction === "payable") {
    const payee = patch.selected?.at(-1);

    parked = { ...parked, ...(payee ? { payee } : {}), ...pix };
    return;
  }

  const selected = patch.selected ? [...new Set([...parked.selected, ...patch.selected])] : parked.selected;

  parked = { ...parked, selected, ...pix };
}

export function clearDraft(): void {
  parked = null;
}
