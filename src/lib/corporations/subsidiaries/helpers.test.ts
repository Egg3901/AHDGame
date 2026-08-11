import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  activeParentDividendFloorPct,
  humanBlockedFromSubsidiaryCeo,
  isEligibleAsSubsidiary,
  isEligibleAsSubsidiaryParent,
  isFormalizedSubsidiary,
  wouldCreateOwnershipCycle,
} from "./helpers";

/** Minimal corp factory for cap-table / control tests. */
function corp(
  id: ObjectId,
  opts: {
    holders?: Array<{ corporationId?: ObjectId; shares: number }>;
    totalShares?: number;
  } = {}
): Corporation {
  return {
    _id: id,
    shareholders: (opts.holders ?? []).map((h) => ({
      corporationId: h.corporationId,
      shares: h.shares,
    })),
    totalShares: opts.totalShares ?? 10_000_000,
  } as any as Corporation;
}

describe("isFormalizedSubsidiary", () => {
  it("is true only with both a controlling parent and the marker", () => {
    const parent = { corporationId: new ObjectId() };
    expect(isFormalizedSubsidiary({ subsidiaryFormalizedAtTurn: 5 }, parent)).toBe(true);
    expect(isFormalizedSubsidiary({ subsidiaryFormalizedAtTurn: undefined }, parent)).toBe(false);
    expect(isFormalizedSubsidiary({ subsidiaryFormalizedAtTurn: 5 }, null)).toBe(false);
  });
});

describe("eligibility", () => {
  it("excludes national corps as parent and subsidiary", () => {
    expect(isEligibleAsSubsidiaryParent({ countryOwnerId: "US" })).toBe(false);
    expect(isEligibleAsSubsidiary({ countryOwnerId: "US" })).toBe(false);
    expect(isEligibleAsSubsidiary({ countryOwnerId: undefined })).toBe(true);
  });
  it("blocks a formalized subsidiary from being a parent (no chaining)", () => {
    expect(isEligibleAsSubsidiaryParent({ subsidiaryFormalizedAtTurn: 3 })).toBe(false);
    expect(isEligibleAsSubsidiaryParent({})).toBe(true);
  });
});

describe("humanBlockedFromSubsidiaryCeo (one-person rule)", () => {
  const parentOwner = new ObjectId();
  const parentCeo = new ObjectId();
  const sibling = new ObjectId();
  it("blocks the parent owner, parent CEO, and sibling operators", () => {
    for (const candidate of [parentOwner, parentCeo, sibling]) {
      expect(
        humanBlockedFromSubsidiaryCeo({
          candidateUserId: candidate,
          parentOwnerUserId: parentOwner,
          parentCeoUserId: parentCeo,
          siblingSubsidiaryCeoUserIds: [sibling],
        })
      ).toBe(true);
    }
  });
  it("allows an unrelated human", () => {
    expect(
      humanBlockedFromSubsidiaryCeo({
        candidateUserId: new ObjectId(),
        parentOwnerUserId: parentOwner,
        parentCeoUserId: parentCeo,
        siblingSubsidiaryCeoUserIds: [sibling],
      })
    ).toBe(false);
  });
});

describe("wouldCreateOwnershipCycle", () => {
  it("flags self and direct back-edges", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    // b is already controlled by a (a→b). Adding b→a would cycle.
    const corpA = corp(a);
    const corpB = corp(b, { holders: [{ corporationId: a, shares: 6_000_000 }] });
    expect(wouldCreateOwnershipCycle(corpB, corpA, [corpA, corpB])).toBe(true);
    // self
    expect(wouldCreateOwnershipCycle(corpA, corpA, [corpA, corpB])).toBe(true);
  });
  it("allows an acyclic new edge", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const corpA = corp(a);
    const corpB = corp(b);
    const corpC = corp(c, { holders: [{ corporationId: b, shares: 6_000_000 }] });
    // Existing: b→c. Adding a→b is acyclic.
    expect(wouldCreateOwnershipCycle(corpA, corpB, [corpA, corpB, corpC])).toBe(false);
  });
  it("detects transitive cycles", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    // a→b, b→c already. Adding c→a would cycle transitively.
    const corpA = corp(a, { holders: [{ corporationId: c, shares: 0 }] });
    const corpB = corp(b, { holders: [{ corporationId: a, shares: 6_000_000 }] });
    const corpC = corp(c, { holders: [{ corporationId: b, shares: 6_000_000 }] });
    expect(wouldCreateOwnershipCycle(corpC, corpA, [corpA, corpB, corpC])).toBe(true);
  });
});

describe("activeParentDividendFloorPct", () => {
  const setter = new ObjectId();
  it("returns the clamped floor while the setter still controls", () => {
    expect(
      activeParentDividendFloorPct({
        enabled: true,
        parentDividendFloorPct: 10,
        parentDividendFloorSetByCorpId: setter,
        controllingParent: { corporationId: setter },
        maxRate: 25,
      })
    ).toBe(10);
  });
  it("clamps to maxRate", () => {
    expect(
      activeParentDividendFloorPct({
        enabled: true,
        parentDividendFloorPct: 99,
        parentDividendFloorSetByCorpId: setter,
        controllingParent: { corporationId: setter },
        maxRate: 25,
      })
    ).toBe(25);
  });
  it("lapses when the flag is off, the setter no longer controls, or nobody controls", () => {
    const base = {
      parentDividendFloorPct: 10,
      parentDividendFloorSetByCorpId: setter,
      maxRate: 25,
    };
    expect(
      activeParentDividendFloorPct({
        ...base,
        enabled: false,
        controllingParent: { corporationId: setter },
      })
    ).toBe(0);
    expect(
      activeParentDividendFloorPct({
        ...base,
        enabled: true,
        controllingParent: { corporationId: new ObjectId() },
      })
    ).toBe(0);
    expect(activeParentDividendFloorPct({ ...base, enabled: true, controllingParent: null })).toBe(
      0
    );
  });
});
