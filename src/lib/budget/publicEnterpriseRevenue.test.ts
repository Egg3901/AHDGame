import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return { ...actual, loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()) };
});

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("calculateCountryOwnedBudgetRevenue (dynamic SOE efficiency)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("politicalMetrics");
  });

  // The efficiency penalty's corruption input is derived from the board's
  // `governance.integrity` (corruption = 100 - integrity), not stored as a
  // legacy metric, so the fixture seeds integrity and the test still talks in
  // corruption terms.
  function seed(corruptionIndex: number, liquidCapital = 1_000_000) {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: corpId,
          name: "National Corp",
          countryId: "US",
          countryOwnerId: "US",
          ownershipState: "stateOwned",
          isNationalized: true,
          budgetRevenueKey: "healthcareIncome",
          budgetRevenueMultiplier: 1,
          liquidCapital,
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "healthcare",
          revenue: 10000,
          currentGrowthCost: 0,
          profitMargin: 40,
        },
      ])
    );
    db.collectionMocks.politicalMetrics.find.mockReturnValue(
      cursor([
        {
          _id: "CA",
          countryId: "US",
          values: { "governance.integrity": 100 - corruptionIndex },
        },
      ])
    );
  }

  it("produces a budget revenue line for a state-owned corp", async () => {
    seed(20);
    const { calculateCountryOwnedBudgetRevenue } = await import("./publicEnterpriseRevenue");
    const lines = await calculateCountryOwnedBudgetRevenue(db as unknown as Db, "US");
    expect(lines.healthcareIncome ?? 0).toBeGreaterThan(0);
  });

  it("yields zero revenue for a cash-poor SOE — no phantom estimated revenue", async () => {
    // Same profitable estimate, but the SOE holds no cash (loss-backed to zero):
    // the budget must reflect what is ACTUALLY remitted, which is nothing.
    seed(20, 0);
    const { calculateCountryOwnedBudgetRevenue } = await import("./publicEnterpriseRevenue");
    const lines = await calculateCountryOwnedBudgetRevenue(db as unknown as Db, "US");
    expect(lines.healthcareIncome ?? 0).toBe(0);
  });

  it("yields more revenue in a low-corruption state than a high-corruption one", async () => {
    seed(0);
    const mod = await import("./publicEnterpriseRevenue");
    const clean = await mod.calculateCountryOwnedBudgetRevenue(db as unknown as Db, "US");

    vi.clearAllMocks();
    seed(100);
    const corrupt = await mod.calculateCountryOwnedBudgetRevenue(db as unknown as Db, "US");

    expect(clean.healthcareIncome ?? 0).toBeGreaterThan(corrupt.healthcareIncome ?? 0);
  });
});

describe("calculateCountryOwnedBudgetRevenue (scaled synthetic corps, multiplier > 1)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("politicalMetrics");
    db.collection("federalBudget");
  });

  function seedScaled(opts: {
    multiplier: number;
    liquidCapital: number;
    gdp: number;
    sectorRevenue?: number;
  }) {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: corpId,
          name: "United Kingdom",
          countryId: "UK",
          countryOwnerId: "UK",
          ownershipState: "stateOwned",
          isNationalized: true,
          budgetRevenueKey: "healthcareIncome",
          budgetRevenueMultiplier: opts.multiplier,
          profitRetentionPercent: 75,
          liquidCapital: opts.liquidCapital,
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "healthcare",
          revenue: opts.sectorRevenue ?? 1_000_000_000,
          currentGrowthCost: 0,
          profitMargin: 35,
        },
      ])
    );
    db.collectionMocks.politicalMetrics.find.mockReturnValue(
      cursor([{ _id: "LON", countryId: "UK", values: { "governance.integrity": 80 } }])
    );
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      gdp: opts.gdp,
    });
  }

  it("still credits the budget when the corp's on-hand cash is 0 (stability — no £0↔huge blink)", async () => {
    // A scaled synthetic corp's budget line is operatingIncome × a large multiplier,
    // so it can NEVER be backed by the corp's game-scale liquidCapital. Capping at
    // on-hand cash made the (huge) NHS line collapse to 0 whenever the corp's cash was
    // drained. With the fix the line reflects the steady-state remittance estimate.
    seedScaled({ multiplier: 1000, liquidCapital: 0, gdp: 1e15 });
    const { calculateCountryOwnedBudgetRevenue } = await import("./publicEnterpriseRevenue");
    const lines = await calculateCountryOwnedBudgetRevenue(db as unknown as Db, "UK");
    expect(lines.healthcareIncome ?? 0).toBeGreaterThan(0);
  });

  it("clamps the scaled contribution to a share of GDP (re-scale — surplus can't exceed GDP)", async () => {
    const gdp = 500_000_000_000;
    seedScaled({ multiplier: 33372, liquidCapital: 1e12, gdp });
    const { calculateCountryOwnedBudgetRevenue, MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE } =
      await import("./publicEnterpriseRevenue");
    const lines = await calculateCountryOwnedBudgetRevenue(db as unknown as Db, "UK");
    expect(lines.healthcareIncome ?? 0).toBe(
      Math.round(gdp * MAX_SCALED_ENTERPRISE_REVENUE_GDP_SHARE)
    );
  });

  it("is stable across turns regardless of on-hand cash (boom/bust eliminated)", async () => {
    const mod = await import("./publicEnterpriseRevenue");
    seedScaled({ multiplier: 33372, liquidCapital: 0, gdp: 500_000_000_000 });
    const drained = await mod.calculateCountryOwnedBudgetRevenue(db as unknown as Db, "UK");
    vi.clearAllMocks();
    seedScaled({ multiplier: 33372, liquidCapital: 1e12, gdp: 500_000_000_000 });
    const flush = await mod.calculateCountryOwnedBudgetRevenue(db as unknown as Db, "UK");
    expect(drained.healthcareIncome ?? 0).toBe(flush.healthcareIncome ?? 0);
  });
});

// ── Plants idle-upkeep mirror (P3b hotfixes) ────────────────────────────────
// The remittance-side idle charge must read PLANT utilization and must fade in
// on the same governor ramp the turn processor uses, or (a) it silently prices
// nothing for non-extraction sectors and (b) SOE remittances step down on the
// flip turn against a turn processor that is still charging zero.
describe("estimateNationalizedOperatingIncome — plants idle upkeep", () => {
  const corp = {
    _id: new ObjectId(),
    name: "SOE",
    countryId: "US",
    countryOwnerId: "US",
    ownershipState: "stateOwned",
    marketingBudget: 0,
    logisticsBudget: 0,
    ceoSalary: 0,
  };

  function sector(extra: Record<string, unknown>) {
    return {
      _id: new ObjectId(),
      corporationId: corp._id,
      countryId: "US",
      stateId: "CA",
      sectorType: "manufacturing",
      revenue: 1_000_000,
      currentGrowthCost: 0,
      profitMargin: 20,
      ...extra,
    };
  }

  async function income(
    s: Record<string, unknown>,
    ramp?: { currentTurn: number; rampTurns: number }
  ) {
    const { estimateNationalizedOperatingIncome } = await import("./publicEnterpriseRevenue");
    return estimateNationalizedOperatingIncome(
      corp as never,
      [sector(s)] as never,
      new Map(),
      new Map(),
      1,
      true,
      ramp
    );
  }

  it("charges idle upkeep off capitalUtilization, not extraction capacityUtilization", async () => {
    // Fully idle plants, but the extraction-geology field says fully utilized.
    // The charge must follow the PLANT field, so this is strictly less
    // profitable than the same sector running its plants flat out.
    const idle = await income({ capitalUtilization: 0, capacityUtilization: 1 });
    const busy = await income({ capitalUtilization: 1, capacityUtilization: 1 });
    expect(idle).toBeLessThan(busy);
  });

  it("ignores capacityUtilization entirely (it is extraction geology, not plants)", async () => {
    const a = await income({ capitalUtilization: 1, capacityUtilization: 0 });
    const b = await income({ capitalUtilization: 1, capacityUtilization: 1 });
    expect(a).toBe(b);
  });

  it("is a no-op on the flip turn and fades in over the governor ramp", async () => {
    const s = { capitalUtilization: 0, plantsStartTurn: 100 };
    const noCharge = await income({ capitalUtilization: 1, plantsStartTurn: 100 });
    // Flip turn: lambda = 0, so the idle charge is exactly zero.
    expect(await income(s, { currentTurn: 100, rampTurns: 10 })).toBe(noCharge);
    // Mid-ramp is partial, end-of-ramp is the full charge.
    const mid = await income(s, { currentTurn: 105, rampTurns: 10 });
    const full = await income(s, { currentTurn: 110, rampTurns: 10 });
    expect(mid).toBeLessThan(noCharge);
    expect(full).toBeLessThan(mid);
    // Past the ramp it stays clamped at the full charge, it does not overshoot.
    expect(await income(s, { currentTurn: 500, rampTurns: 10 })).toBe(full);
  });
});
