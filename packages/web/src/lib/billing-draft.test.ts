import { Direction, EMPTY_BILLING_DRAFT } from "@receivy/common";
import { beforeEach, expect, it } from "vitest";
import { patchDraft, saveDraft, takeDraft } from "./billing-draft";

function draft() {
  return { ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), amount: "100,00", selected: ["u1"] };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

it("round trips the draft and clears the storage on read", () => {
  saveDraft(draft(), "/billings/new");

  const stored = takeDraft();

  expect(stored).toEqual({ draft: draft(), returnTo: "/billings/new" });
  expect(window.sessionStorage.getItem("receivy.billingDraft")).toBeNull();
  expect(takeDraft()).toBeNull();
});

it("returns null when nothing was saved", () => {
  expect(takeDraft()).toBeNull();
});

it("returns null and does not throw when the stored payload is corrupt", () => {
  window.sessionStorage.setItem("receivy.billingDraft", "{not json");

  expect(takeDraft()).toBeNull();
});

it("unions the selected contacts without dropping the stored draft", () => {
  saveDraft(draft(), "/billings/new");

  patchDraft({ selected: ["u2"] });
  patchDraft({ selected: ["u2"] });

  const stored = takeDraft();

  expect(stored?.draft.selected).toEqual(["u1", "u2"]);
  expect(stored?.draft.amount).toBe("100,00");
  expect(stored?.returnTo).toBe("/billings/new");
});

it("hands a new contact to the payee when the parked draft is a conta a pagar", () => {
  saveDraft({ ...draft(), direction: Direction.Payable, selected: [] }, "/billings/new");

  patchDraft({ selected: ["u2"] });

  const stored = takeDraft();

  expect(stored?.draft.payee).toBe("u2");
  expect(stored?.draft.selected).toEqual([]);
  expect(stored?.draft.amount).toBe("100,00");
});

it("replaces the Pix key and keeps everything else", () => {
  saveDraft(draft(), "/billings/new");

  patchDraft({ pix: "pix-1" });

  const stored = takeDraft();

  expect(stored?.draft.pix).toBe("pix-1");
  expect(stored?.draft.selected).toEqual(["u1"]);
});

it("ignores a patch when no draft is stored", () => {
  patchDraft({ pix: "pix-1" });

  expect(takeDraft()).toBeNull();
});
