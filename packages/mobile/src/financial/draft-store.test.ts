import { EMPTY_BILLING_DRAFT } from "@receivy/common";
import { clearDraft, clearPixRequiredSeen, markPixRequiredSeen, patchDraft, pixRequiredSeen, saveDraft, takeDraft } from "./draft-store";

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
    patchDraft({ selected: ["p2"] });
    patchDraft({ selected: ["p2"] });

    expect(takeDraft()?.selected).toEqual(["p1", "p2"]);
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
    patchDraft({ selected: ["p2"], pix: "pix-1" });

    expect(takeDraft()).toBeNull();
  });

  it("drops the draft on cancel", () => {
    saveDraft(draft());
    clearDraft();

    expect(takeDraft()).toBeNull();
  });

  it("remembers the trip to the Pix keys so the form never bounces twice", () => {
    expect(pixRequiredSeen()).toBe(false);

    markPixRequiredSeen();

    expect(pixRequiredSeen()).toBe(true);
  });

  it("forgets the Pix trip when the draft is dropped or a key shows up", () => {
    markPixRequiredSeen();
    clearDraft();

    expect(pixRequiredSeen()).toBe(false);

    markPixRequiredSeen();
    clearPixRequiredSeen();

    expect(pixRequiredSeen()).toBe(false);
  });
});
