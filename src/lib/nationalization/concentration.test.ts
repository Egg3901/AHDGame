import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  clampConcentration,
  computeStateOwnershipConcentration,
  sociMultiplier,
  readStateOwnershipConcentration,
  writeStateOwnershipConcentration,
  computeCountryStateOwnershipConcentration,
} from "./concentration";
import { SOCI_DANGER_ZONE, CONCENTRATION_MULTIPLIER_MAX } from "./constants";

function cursorFrom<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

describe("computeStateOwnershipConcentration", () => {
  it("returns 0 when there is no corporate revenue", () => {
    expect(
      computeStateOwnershipConcentration({ stateRevenueAnchor: 0, totalRevenueAnchor: 0 })
    ).toBe(0);
    expect(
      computeStateOwnershipConcentration({ stateRevenueAnchor: 5, totalRevenueAnchor: 0 })
    ).toBe(0);
  });

  it("is the state share of total revenue, as a 0–100 percentage", () => {
    expect(
      computeStateOwnershipConcentration({ stateRevenueAnchor: 250, totalRevenueAnchor: 1000 })
    ).toBe(25);
    expect(
      computeStateOwnershipConcentration({ stateRevenueAnchor: 1000, totalRevenueAnchor: 1000 })
    ).toBe(100);
  });

  it("clamps a state sum that exceeds total to 100", () => {
    expect(
      computeStateOwnershipConcentration({ stateRevenueAnchor: 1500, totalRevenueAnchor: 1000 })
    ).toBe(100);
  });
});

describe("sociMultiplier", () => {
  it("is exactly 1.0 at and below the danger zone (regression-safe)", () => {
    expect(sociMultiplier(0)).toBe(1);
    expect(sociMultiplier(SOCI_DANGER_ZONE)).toBe(1);
    expect(sociMultiplier(SOCI_DANGER_ZONE - 5)).toBe(1);
  });

  it("reaches the configured max at full state ownership", () => {
    expect(sociMultiplier(100)).toBeCloseTo(CONCENTRATION_MULTIPLIER_MAX, 5);
  });

  it("rises convexly and monotonically past the danger zone", () => {
    const mid = sociMultiplier((SOCI_DANGER_ZONE + 100) / 2);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(CONCENTRATION_MULTIPLIER_MAX);
    // convex: the midpoint is below the linear midpoint between 1 and MAX
    expect(mid).toBeLessThan((1 + CONCENTRATION_MULTIPLIER_MAX) / 2);
    expect(sociMultiplier(80)).toBeGreaterThan(sociMultiplier(60));
  });
});

describe("clampConcentration", () => {
  it("clamps to [0,100] and maps non-finite to 0", () => {
    expect(clampConcentration(-5)).toBe(0);
    expect(clampConcentration(150)).toBe(100);
    expect(clampConcentration(Number.NaN)).toBe(0);
  });
});

describe("SOCI read/write helpers", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("federalBudget");
  });

  it("reads a stored value, clamps it, and defaults missing to 0", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValueOnce({
      stateOwnershipConcentration: 42,
    });
    expect(await readStateOwnershipConcentration(db as unknown as Db, "CN")).toBe(42);

    db.collectionMocks.federalBudget.findOne.mockResolvedValueOnce({
      stateOwnershipConcentration: 150,
    });
    expect(await readStateOwnershipConcentration(db as unknown as Db, "CN")).toBe(100);

    db.collectionMocks.federalBudget.findOne.mockResolvedValueOnce(null);
    expect(await readStateOwnershipConcentration(db as unknown as Db, "US")).toBe(0);
  });

  it("writes a clamped value and stamps the turn", async () => {
    await writeStateOwnershipConcentration(db as unknown as Db, "CN", 37.5, 601);
    const call = db.collectionMocks.federalBudget.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "CN" });
    expect(call[1].$set.stateOwnershipConcentration).toBe(37.5);
    expect(call[1].$set.stateOwnershipConcentrationUpdatedAtTurn).toBe(601);
  });
});

describe("computeCountryStateOwnershipConcentration", () => {
  let db: MockDb;
  const stateCorpId = new ObjectId();
  const privateCorpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("corporations");
  });

  it("returns 0 when the country has no corporate sectors", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursorFrom([]));
    const soci = await computeCountryStateOwnershipConcentration(
      db as unknown as Db,
      "US",
      new Map()
    );
    expect(soci).toBe(0);
  });

  it("computes the state-owned revenue share (same currency, rate 1.0)", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursorFrom([
        { corporationId: stateCorpId, revenue: 300, countryId: "CN" },
        { corporationId: privateCorpId, revenue: 700, countryId: "CN" },
      ])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorFrom([
        { _id: stateCorpId, countryOwnerId: "CN", liquidCurrencyCode: "CNY" },
        { _id: privateCorpId, countryId: "CN", liquidCurrencyCode: "CNY" },
      ])
    );
    // FX map: 1 CNY → 1 ₳ for both corps (rate 1.0)
    const fx = new Map<CurrencyCode, number>([["CNY", 1]]);
    const soci = await computeCountryStateOwnershipConcentration(db as unknown as Db, "CN", fx);
    expect(soci).toBe(30); // 300 / (300 + 700)
  });

  it("excludes a FOREIGN state's corp from the numerator (denominator only)", async () => {
    const foreignStateCorpId = new ObjectId();
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursorFrom([
        { corporationId: stateCorpId, revenue: 200, countryId: "CN" }, // CN-owned
        { corporationId: foreignStateCorpId, revenue: 300, countryId: "CN" }, // IE-owned, operating in CN
        { corporationId: privateCorpId, revenue: 500, countryId: "CN" }, // private
      ])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursorFrom([
        { _id: stateCorpId, countryOwnerId: "CN", liquidCurrencyCode: "CNY" },
        { _id: foreignStateCorpId, countryOwnerId: "IE", liquidCurrencyCode: "CNY" },
        { _id: privateCorpId, countryId: "CN", liquidCurrencyCode: "CNY" },
      ])
    );
    const fx = new Map<CurrencyCode, number>([["CNY", 1]]);
    const soci = await computeCountryStateOwnershipConcentration(db as unknown as Db, "CN", fx);
    // numerator = CN-owned 200; denominator = 200 + 300 + 500 = 1000 ⇒ 20
    expect(soci).toBe(20);
  });
});
