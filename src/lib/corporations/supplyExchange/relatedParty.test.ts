import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { resolveRelatedParty, type RelatedPartyCorp } from "./relatedParty";

const corp = (over: Partial<RelatedPartyCorp> = {}): RelatedPartyCorp => ({
  _id: new ObjectId(),
  userId: new ObjectId(),
  ceoId: new ObjectId(),
  ceoType: "character",
  shareholders: [],
  totalShares: 1000,
  ...over,
});

describe("resolveRelatedParty", () => {
  it("treats unrelated corporations as arm's length", () => {
    expect(resolveRelatedParty(corp(), corp())).toBeNull();
  });

  it("catches the same owner and the same CEO", () => {
    const owner = new ObjectId();
    expect(resolveRelatedParty(corp({ userId: owner }), corp({ userId: owner }))).toBe("owner");
    const ceo = new ObjectId();
    expect(resolveRelatedParty(corp({ ceoId: ceo }), corp({ ceoId: ceo }))).toBe("ceo");
  });

  it("does not confuse a character id with an NPP id", () => {
    const id = new ObjectId();
    expect(
      resolveRelatedParty(corp({ ceoId: id }), corp({ ceoId: id, ceoType: "npp" }))
    ).toBeNull();
  });

  it("catches a 5% holding by the other side's CEO character, in either direction", () => {
    const ceo = new ObjectId();
    const holder = corp({ ceoId: ceo });
    const held = corp({ shareholders: [{ characterId: ceo, shares: 50 }] });
    expect(resolveRelatedParty(holder, held)).toBe("shareholding");
    expect(resolveRelatedParty(held, holder)).toBe("shareholding");
  });

  it("catches a corporate holding at the threshold and ignores one below it", () => {
    const holder = corp();
    const at = corp({ shareholders: [{ corporationId: holder._id, shares: 50 }] });
    const below = corp({ shareholders: [{ corporationId: holder._id, shares: 49 }] });
    expect(resolveRelatedParty(holder, at)).toBe("shareholding");
    expect(resolveRelatedParty(holder, below)).toBeNull();
  });
});
