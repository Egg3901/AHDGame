import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { SHARE_CONSOLIDATION_MIN_TOTAL_SHARES } from "@/lib/constants/corporations";
import type { Corporation } from "@/lib/db/types";
import {
  allocateProportionalShareTotals,
  assertShareStructureChangePreservesHolders,
  corporationCanRestructureShares,
  findDroppedShareholders,
  issuanceDilutionFactor,
  planFundHoldingSplitSync,
  scaleSharePricesForStructureChange,
  sumAccountedOutstandingShares,
} from "./shareConsolidation";

function baseCorp(over: Partial<Corporation> = {}): Corporation {
  const a = new ObjectId();
  const b = new ObjectId();
  return {
    _id: new ObjectId(),
    name: "TestCo",
    type: "technology",
    ceoId: a,
    userId: new ObjectId(),
    headquartersState: "US_CA",
    liquidCapital: 1e6,
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    totalShares: 100,
    sharePrice: 0.5,
    shareholders: [
      { characterId: a, shares: 60 },
      { characterId: b, shares: 30 },
    ],
    publicFloat: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Corporation;
}

describe("corporationCanRestructureShares", () => {
  it("allows private corporations with positive shares", () => {
    expect(corporationCanRestructureShares(baseCorp())).toEqual({ ok: true });
  });

  it("rejects nationalized corporations", () => {
    expect(corporationCanRestructureShares(baseCorp({ isNationalized: true })).ok).toBe(false);
  });

  it("rejects state-owned corporations", () => {
    expect(corporationCanRestructureShares(baseCorp({ countryOwnerId: "US" })).ok).toBe(false);
  });
});

describe("sumAccountedOutstandingShares", () => {
  it("sums shareholders and float", () => {
    expect(sumAccountedOutstandingShares(baseCorp())).toBe(100);
  });
});

describe("allocateProportionalShareTotals", () => {
  it("preserves total and scales proportionally (halve)", () => {
    const corp = baseCorp();
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 50);
    expect(publicFloat + shareholders.reduce((s, h) => s + h.shares, 0)).toBe(50);
    expect(publicFloat).toBe(5);
    const byId = Object.fromEntries(shareholders.map((h) => [h.characterId!.toString(), h.shares]));
    expect(byId[corp.shareholders[0]!.characterId!.toString()]).toBe(30);
    expect(byId[corp.shareholders[1]!.characterId!.toString()]).toBe(15);
  });

  it("handles float-only capitalization", () => {
    const corp = baseCorp({
      shareholders: [],
      publicFloat: 1_000_000,
      totalShares: 1_000_000,
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 500_000);
    expect(shareholders).toHaveLength(0);
    expect(publicFloat).toBe(500_000);
  });

  it("preserves corporation holders through a reverse split", () => {
    const character = new ObjectId();
    const holderCorp = new ObjectId();
    const corp = baseCorp({
      totalShares: 10_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: character, shares: 9_000_000 },
        { corporationId: holderCorp, shares: 1_000_000 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    expect(publicFloat).toBe(0);
    const charEntry = shareholders.find((h) => h.characterId?.toString() === character.toString());
    const corpEntry = shareholders.find(
      (h) => h.corporationId?.toString() === holderCorp.toString()
    );
    expect(charEntry?.shares).toBe(900_000);
    expect(corpEntry?.shares).toBe(100_000);
    expect(shareholders.reduce((s, h) => s + h.shares, 0) + publicFloat).toBe(1_000_000);
  });

  it("preserves imperial character holders through a forward split", () => {
    const character = new ObjectId();
    const imperial = new ObjectId();
    const corp = baseCorp({
      totalShares: 1_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: character, shares: 750_000 },
        { imperialCharacterId: imperial, shares: 250_000 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 4_000_000);
    expect(publicFloat).toBe(0);
    const charEntry = shareholders.find((h) => h.characterId?.toString() === character.toString());
    const impEntry = shareholders.find(
      (h) => h.imperialCharacterId?.toString() === imperial.toString()
    );
    expect(charEntry?.shares).toBe(3_000_000);
    expect(impEntry?.shares).toBe(1_000_000);
    expect(shareholders.reduce((s, h) => s + h.shares, 0) + publicFloat).toBe(4_000_000);
  });

  it("keeps mixed character / imperial / corp holders disjoint after reverse split", () => {
    const character = new ObjectId();
    const imperial = new ObjectId();
    const holderCorp = new ObjectId();
    const corp = baseCorp({
      totalShares: 10_000_000,
      publicFloat: 1_000_000,
      shareholders: [
        { characterId: character, shares: 5_000_000 },
        { imperialCharacterId: imperial, shares: 2_000_000 },
        { corporationId: holderCorp, shares: 2_000_000 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    expect(publicFloat + shareholders.reduce((s, h) => s + h.shares, 0)).toBe(1_000_000);
    // Public float 10% of old total remains 10% of new total (100,000).
    expect(publicFloat).toBe(100_000);

    const charEntry = shareholders.find((h) => h.characterId?.toString() === character.toString());
    const impEntry = shareholders.find(
      (h) => h.imperialCharacterId?.toString() === imperial.toString()
    );
    const corpEntry = shareholders.find(
      (h) => h.corporationId?.toString() === holderCorp.toString()
    );
    expect(charEntry?.shares).toBe(500_000);
    expect(impEntry?.shares).toBe(200_000);
    expect(corpEntry?.shares).toBe(200_000);
    // Each entry carries exactly one owner id.
    for (const h of shareholders) {
      const idsSet = [h.characterId, h.imperialCharacterId, h.corporationId].filter(Boolean).length;
      expect(idsSet).toBe(1);
    }
  });

  it("preserves a 1-share holder through a large reverse split and steals from largest", () => {
    const whale = new ObjectId();
    const tiny = new ObjectId();
    const corp = baseCorp({
      totalShares: 10_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: whale, shares: 9_999_999 },
        { characterId: tiny, shares: 1 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    expect(publicFloat).toBe(0);
    const tinyEntry = shareholders.find((h) => h.characterId?.toString() === tiny.toString());
    const whaleEntry = shareholders.find((h) => h.characterId?.toString() === whale.toString());
    // Tiny holder must survive with at least 1 share.
    expect(tinyEntry?.shares).toBe(1);
    // The 1 share comes out of the whale's allocation (999,999 instead of 1,000,000).
    expect(whaleEntry?.shares).toBe(999_999);
    expect(shareholders.reduce((s, h) => s + h.shares, 0) + publicFloat).toBe(1_000_000);
  });

  it("preserves multiple 1-share holders by repeatedly stealing from the largest", () => {
    const whale = new ObjectId();
    const tinyA = new ObjectId();
    const tinyB = new ObjectId();
    const tinyC = new ObjectId();
    const corp = baseCorp({
      totalShares: 10_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: whale, shares: 9_999_997 },
        { characterId: tinyA, shares: 1 },
        { characterId: tinyB, shares: 1 },
        { characterId: tinyC, shares: 1 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    expect(publicFloat).toBe(0);
    for (const id of [tinyA, tinyB, tinyC]) {
      const entry = shareholders.find((h) => h.characterId?.toString() === id.toString());
      expect(entry?.shares).toBe(1);
    }
    const whaleEntry = shareholders.find((h) => h.characterId?.toString() === whale.toString());
    expect(whaleEntry?.shares).toBe(999_997);
    expect(shareholders.reduce((s, h) => s + h.shares, 0) + publicFloat).toBe(1_000_000);
  });

  it("preserves fund holders through a reverse split (splits must not confiscate index funds)", () => {
    const character = new ObjectId();
    const fund = new ObjectId();
    const corp = baseCorp({
      totalShares: 10_000_000,
      publicFloat: 0,
      shareholders: [
        { characterId: character, shares: 9_000_000 },
        { fundId: fund, shares: 1_000_000 },
      ],
    });
    const { publicFloat, shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    const charEntry = shareholders.find((h) => h.characterId?.toString() === character.toString());
    const fundEntry = shareholders.find((h) => h.fundId?.toString() === fund.toString());
    expect(fundEntry?.shares).toBe(100_000);
    expect(charEntry?.shares).toBe(900_000);
    // A fund entry must carry fundId only — never be mis-assigned to corporationId.
    expect(fundEntry?.corporationId).toBeUndefined();
    for (const h of shareholders) {
      const ids = [h.characterId, h.imperialCharacterId, h.corporationId, h.fundId].filter(
        Boolean
      ).length;
      expect(ids).toBe(1);
    }
    expect(shareholders.reduce((s, h) => s + h.shares, 0) + publicFloat).toBe(1_000_000);
  });

  it("scales fund holder avgCostPerShare like other holders", () => {
    const fund = new ObjectId();
    const character = new ObjectId();
    const corp = baseCorp({
      totalShares: 2_000_000,
      publicFloat: 0,
      sharePrice: 10,
      shareholders: [
        { characterId: character, shares: 1_500_000, avgCostPerShare: 6 },
        { fundId: fund, shares: 500_000, avgCostPerShare: 8 },
      ],
    });
    const { shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    const fundEntry = shareholders.find((h) => h.fundId?.toString() === fund.toString());
    // Reverse split by 2× doubles cost basis per share ($8 → $16).
    expect(fundEntry?.avgCostPerShare).toBeCloseTo(16, 4);
  });

  it("preserves avgCostPerShare on each holder after a split", () => {
    const character = new ObjectId();
    const holderCorp = new ObjectId();
    const corp = baseCorp({
      totalShares: 2_000_000,
      publicFloat: 0,
      sharePrice: 10,
      shareholders: [
        { characterId: character, shares: 1_500_000, avgCostPerShare: 6 },
        { corporationId: holderCorp, shares: 500_000, avgCostPerShare: 8 },
      ],
    });
    const { shareholders } = allocateProportionalShareTotals(corp, 1_000_000);
    const charEntry = shareholders.find((h) => h.characterId?.toString() === character.toString());
    const corpEntry = shareholders.find(
      (h) => h.corporationId?.toString() === holderCorp.toString()
    );
    // Reverse split by 2× doubles cost basis per share (old $6 per share → $12 per new share).
    expect(charEntry?.avgCostPerShare).toBeCloseTo(12, 4);
    expect(corpEntry?.avgCostPerShare).toBeCloseTo(16, 4);
  });
});

describe("planFundHoldingSplitSync", () => {
  it("returns the new cap-table share count and basis factor for each surviving fund holder", () => {
    const fundA = new ObjectId();
    const fundB = new ObjectId();
    const character = new ObjectId();
    const newShareholders = [
      { characterId: character, shares: 900_000 },
      { fundId: fundA, shares: 100_000 },
    ];
    const syncs = planFundHoldingSplitSync(newShareholders, 10_000_000, 1_000_000);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.fundId.toString()).toBe(fundA.toString());
    expect(syncs[0]?.newShares).toBe(100_000);
    // Reverse split 10:1 ⇒ per-share cost basis scales ×10.
    expect(syncs[0]?.basisFactor).toBeCloseTo(10, 6);
    expect(fundB).toBeDefined();
  });

  it("skips fund entries that round to zero shares and non-fund holders", () => {
    const fund = new ObjectId();
    const character = new ObjectId();
    const syncs = planFundHoldingSplitSync(
      [
        { characterId: character, shares: 500 },
        { fundId: fund, shares: 0 },
      ],
      1000,
      10
    );
    expect(syncs).toHaveLength(0);
  });

  it("returns empty for non-positive totals", () => {
    const fund = new ObjectId();
    expect(planFundHoldingSplitSync([{ fundId: fund, shares: 10 }], 0, 100)).toHaveLength(0);
  });
});

describe("scaleSharePricesForStructureChange", () => {
  it("scales price so market cap is preserved (reverse split)", () => {
    const out = scaleSharePricesForStructureChange(400_000_000, 1_000_000, 0.25);
    expect(out.sharePrice).toBe(100);
    const oldCap = 400_000_000 * 0.25;
    const newCap = 1_000_000 * out.sharePrice;
    expect(newCap).toBeCloseTo(oldCap, 4);
  });

  it("scales down for forward split", () => {
    const out = scaleSharePricesForStructureChange(100, 200, 10);
    expect(out.sharePrice).toBe(5);
  });
});

describe("SHARE_CONSOLIDATION_MIN_TOTAL_SHARES", () => {
  it("matches reverse-split floor used by API", () => {
    expect(SHARE_CONSOLIDATION_MIN_TOTAL_SHARES).toBe(1_000_000);
  });
});

describe("assertShareStructureChangePreservesHolders", () => {
  it("passes when every input holder (all three kinds) is present in output", () => {
    const character = new ObjectId();
    const imperial = new ObjectId();
    const holderCorp = new ObjectId();
    const before = [
      { characterId: character, shares: 500 },
      { imperialCharacterId: imperial, shares: 200 },
      { corporationId: holderCorp, shares: 300 },
    ];
    const after = [
      { characterId: character, shares: 50 },
      { imperialCharacterId: imperial, shares: 20 },
      { corporationId: holderCorp, shares: 30 },
    ];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).not.toThrow();
  });

  it("throws when a corporation holder is missing from output", () => {
    const character = new ObjectId();
    const holderCorp = new ObjectId();
    const before = [
      { characterId: character, shares: 900 },
      { corporationId: holderCorp, shares: 100 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).toThrow(
      /dropped holders/i
    );
  });

  it("throws when an imperial holder is missing from output", () => {
    const character = new ObjectId();
    const imperial = new ObjectId();
    const before = [
      { characterId: character, shares: 500 },
      { imperialCharacterId: imperial, shares: 500 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).toThrow(
      /dropped holders/i
    );
  });

  it("ignores zero-share input rows (they are not expected to appear in output)", () => {
    const character = new ObjectId();
    const ghostCorp = new ObjectId();
    const before = [
      { characterId: character, shares: 1000 },
      { corporationId: ghostCorp, shares: 0 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).not.toThrow();
  });

  it("throws when a fund holder is missing from output", () => {
    const character = new ObjectId();
    const fund = new ObjectId();
    const before = [
      { characterId: character, shares: 500 },
      { fundId: fund, shares: 500 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).toThrow(
      /dropped holders/i
    );
  });

  it("does not count a mismatched holder kind as equivalent", () => {
    // Same ObjectId string on a different kind must not satisfy the invariant.
    const oid = new ObjectId();
    const before = [{ corporationId: oid, shares: 1000 }];
    const after = [{ characterId: oid, shares: 100 }];
    expect(() => assertShareStructureChangePreservesHolders(before, after)).toThrow(
      /dropped holders/i
    );
  });
});

describe("findDroppedShareholders", () => {
  it("returns empty when all holders survive", () => {
    const character = new ObjectId();
    const imperial = new ObjectId();
    const holderCorp = new ObjectId();
    const before = [
      { characterId: character, shares: 500 },
      { imperialCharacterId: imperial, shares: 200 },
      { corporationId: holderCorp, shares: 300 },
    ];
    const after = [
      { characterId: character, shares: 50 },
      { imperialCharacterId: imperial, shares: 20 },
      { corporationId: holderCorp, shares: 30 },
    ];
    expect(findDroppedShareholders(before, after)).toHaveLength(0);
  });

  it("returns structured entries for each dropped holder kind", () => {
    const character = new ObjectId();
    const holderCorp = new ObjectId();
    const before = [
      { characterId: character, shares: 900 },
      { corporationId: holderCorp, shares: 100 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    const dropped = findDroppedShareholders(before, after);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.kind).toBe("corporation");
    expect(dropped[0]?.ownerId.toString()).toBe(holderCorp.toString());
  });

  it("detects a dropped fund holder", () => {
    const character = new ObjectId();
    const fund = new ObjectId();
    const before = [
      { characterId: character, shares: 900 },
      { fundId: fund, shares: 100 },
    ];
    const after = [{ characterId: character, shares: 100 }];
    const dropped = findDroppedShareholders(before, after);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.kind).toBe("fund");
    expect(dropped[0]?.ownerId.toString()).toBe(fund.toString());
  });

  it("treats a zero-share output row as dropped", () => {
    const character = new ObjectId();
    const tiny = new ObjectId();
    const before = [
      { characterId: character, shares: 900 },
      { characterId: tiny, shares: 1 },
    ];
    const after = [
      { characterId: character, shares: 100 },
      { characterId: tiny, shares: 0 },
    ];
    const dropped = findDroppedShareholders(before, after);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.ownerId.toString()).toBe(tiny.toString());
  });
});

describe("issuanceDilutionFactor (2026-08-20 market-cap fabrication fix)", () => {
  it("preserves market cap across an issuance", () => {
    // 1.02M shares at 3158 must be worth the same after 128.1M new shares.
    const oldTotal = 1_020_000;
    const newShares = 128_124_511;
    const price = 3158;
    const factor = issuanceDilutionFactor(oldTotal, newShares);
    const capBefore = oldTotal * price;
    const capAfter = (oldTotal + newShares) * price * factor;
    expect(capAfter).toBeCloseTo(capBefore, 3);
  });

  it("is the forward-split scaling for the same share counts", () => {
    const factor = issuanceDilutionFactor(100, 300);
    const split = scaleSharePricesForStructureChange(100, 400, 1).sharePrice;
    expect(factor).toBeCloseTo(split, 10);
  });

  it("degenerate inputs return 1 (no scaling)", () => {
    expect(issuanceDilutionFactor(0, 100)).toBe(1);
    expect(issuanceDilutionFactor(-5, 100)).toBe(1);
    expect(issuanceDilutionFactor(100, 0)).toBe(1);
  });
});
