import { Direction, EMPTY_BILLING_DRAFT } from "@receivy/common";
import { clearDraft, patchDraft, saveDraft, takeDraft } from "./draft-store";

function draft() {
  return { ...EMPTY_BILLING_DRAFT("America/Sao_Paulo", "2026-09-08"), selected: ["p1"], amount: "85,00" };
}

describe("billing draft store", () => {
  afterEach(() => clearDraft());

  it("returns nothing when no draft was saved", () => {
    expect(takeDraft()).toBeNull();
  });

  it("reads the saved draft once and clears it", () => {
    saveDraft(draft());

    expect(takeDraft()).toMatchObject({ selected: ["p1"], amount: "85,00" });
    expect(takeDraft()).toBeNull();
  });

  it("unions the contacts a side trip created", () => {
    saveDraft(draft());
    patchDraft({ contact: { id: "c2", userId: "p2" } });
    patchDraft({ contact: { id: "c2", userId: "p2" } });

    expect(takeDraft()?.selected).toEqual(["p1", "p2"]);
  });

  it("seats the contact a side trip created as the receiving contact of a conta a pagar, by its agenda entry", () => {
    saveDraft({ ...draft(), direction: Direction.Payable, selected: [] });
    patchDraft({ contact: { id: "c2", userId: "p2" } });

    expect(takeDraft()).toMatchObject({ payee: "c2", selected: [] });
  });

  it("replaces the single payer of a parked registro a receber instead of unioning it", () => {
    saveDraft({ ...draft(), settled: true });
    patchDraft({ contact: { id: "c2", userId: "p2" } });

    expect(takeDraft()?.selected).toEqual(["p2"]);
  });

  it("selects the Pix key a side trip created", () => {
    saveDraft(draft());
    patchDraft({ pix: "pix-1" });

    expect(takeDraft()?.pix).toBe("pix-1");
  });

  it("keeps the draft untouched when a patch carries nothing", () => {
    saveDraft(draft());
    patchDraft({});

    expect(takeDraft()).toMatchObject({ selected: ["p1"], pix: "" });
  });

  it("ignores a patch when there is no draft to return to", () => {
    patchDraft({ contact: { id: "c2", userId: "p2" }, pix: "pix-1" });

    expect(takeDraft()).toBeNull();
  });

  it("drops the draft on cancel", () => {
    saveDraft(draft());
    clearDraft();

    expect(takeDraft()).toBeNull();
  });
});
