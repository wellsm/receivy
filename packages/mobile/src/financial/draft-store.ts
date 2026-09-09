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
let pixRequired = false;

export function saveDraft(draft: BillingDraft): void {
  parked = draft;
}

/** Reads the parked draft and clears it, so a restore never happens twice. */
export function takeDraft(): BillingDraft | null {
  const draft = parked;

  parked = null;

  return draft;
}

/** Merges the result of a side trip (a new contact, a new Pix key) into the parked draft. */
export function patchDraft(patch: { selected?: string[]; pix?: string }): void {
  if (!parked) {
    return;
  }

  const selected = patch.selected ? [...new Set([...parked.selected, ...patch.selected])] : parked.selected;

  parked = { ...parked, selected, ...(patch.pix === undefined ? {} : { pix: patch.pix }) };
}

export function clearDraft(): void {
  parked = null;
  pixRequired = false;
}

export function pixRequiredSeen(): boolean {
  return pixRequired;
}

export function markPixRequiredSeen(): void {
  pixRequired = true;
}

export function clearPixRequiredSeen(): void {
  pixRequired = false;
}
