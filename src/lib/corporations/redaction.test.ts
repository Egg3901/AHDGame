import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  shouldRedactCorporation,
  redactPrivateCorporation,
  redactPrivateSectorRow,
  redactPrivateBondRow,
} from "./redaction";

describe("shouldRedactCorporation", () => {
  it("returns false when corp is public", () => {
    const corp = { isPrivate: false, userId: new ObjectId() };
    expect(shouldRedactCorporation(corp as never, "anyUserId", false)).toBe(false);
  });
  it("returns false when viewer is the owning user", () => {
    const userId = new ObjectId();
    const corp = { isPrivate: true, userId };
    expect(shouldRedactCorporation(corp as never, userId.toString(), false)).toBe(false);
  });
  it("returns false when viewer is admin", () => {
    const corp = { isPrivate: true, userId: new ObjectId() };
    expect(shouldRedactCorporation(corp as never, "other", true)).toBe(false);
  });
  it("returns false when moderator override is active", () => {
    const corp = { isPrivate: true, userId: new ObjectId() };
    expect(shouldRedactCorporation(corp as never, "other", false, true)).toBe(false);
  });
  it("returns true when private and viewer is not owner and not admin", () => {
    const corp = { isPrivate: true, userId: new ObjectId() };
    expect(shouldRedactCorporation(corp as never, "other", false)).toBe(true);
  });
  it("returns false when isPrivate is missing/false (legacy public corps)", () => {
    expect(shouldRedactCorporation({ userId: new ObjectId() } as never, "other", false)).toBe(
      false
    );
  });
});

describe("redactPrivateCorporation", () => {
  it("strips treasury, income, share-price metadata, and budget fields", () => {
    const corp = {
      _id: new ObjectId(),
      name: "Acme",
      type: "manufacturing",
      isPrivate: true,
      liquidCapital: 5_000_000,
      liquidCurrencyCode: "USD",
      sharePrice: 0.5,
      marketingBudget: 100_000,
      logisticsBudget: 50_000,
      rdBudget: 0,
      ceoSalary: 5000,
      dividendRate: 10,
      lastDividendChange: new Date(),
      earningsHistory: [1, 2, 3],
      fundamentalSharePrice: 0.4,
      orderFlowMultiplier: 1.0,
      orderFlowWindowBuyValue: 0,
      orderFlowWindowSellValue: 0,
      creditCompositeSnapshot: 0.7,
      creditRatingSnapshot: "BBB",
      creditSnapshotTurn: 100,
      marketingStrength: 25,
      logisticsStrength: 10,
      rdScore: 5,
    };
    const redacted = redactPrivateCorporation(corp as never);
    expect((redacted as Record<string, unknown>).name).toBe("Acme");
    expect((redacted as Record<string, unknown>).creditRatingSnapshot).toBe("BBB");
    expect("liquidCapital" in redacted).toBe(false);
    expect("sharePrice" in redacted).toBe(false);
    expect("marketingBudget" in redacted).toBe(false);
    expect("dividendRate" in redacted).toBe(false);
    expect("earningsHistory" in redacted).toBe(false);
    expect("creditCompositeSnapshot" in redacted).toBe(false);
  });
});

describe("redactPrivateSectorRow", () => {
  it("strips revenue, profitMargin, currentGrowthCost, workers", () => {
    const sector = {
      _id: new ObjectId(),
      sectorType: "manufacturing",
      stateId: "CA",
      revenue: 10_000,
      profitMargin: 25,
      currentGrowthCost: 100,
      workers: 1000,
      productionPolicy: 5,
    };
    const r = redactPrivateSectorRow(sector as never);
    expect("revenue" in r).toBe(false);
    expect("profitMargin" in r).toBe(false);
    expect("currentGrowthCost" in r).toBe(false);
    expect("workers" in r).toBe(false);
    expect((r as Record<string, unknown>).productionPolicy).toBe(5);
    expect((r as Record<string, unknown>).stateId).toBe("CA");
  });

  it("also strips financialRevenue and realizedRevenue (same sensitivity as revenue)", () => {
    // Regression: a nameplate-vs-realized display fix added these fields
    // alongside `revenue` on the sector payload — they carry the same
    // financial signal `revenue` does and must be redacted identically, or a
    // private corp's numbers leak through the field the display code prefers.
    const sector = {
      _id: new ObjectId(),
      sectorType: "manufacturing",
      stateId: "CA",
      revenue: 10_000,
      financialRevenue: 9_500,
      realizedRevenue: 9_500,
      profitMargin: 25,
      currentGrowthCost: 100,
      workers: 1000,
    };
    const r = redactPrivateSectorRow(sector as never);
    expect("financialRevenue" in r).toBe(false);
    expect("realizedRevenue" in r).toBe(false);
  });
});

describe("redactPrivateBondRow", () => {
  it("keeps id and metadata; strips amounts", () => {
    const bond = {
      _id: new ObjectId(),
      maturityTurns: 240,
      ratingAtIssuance: "BBB",
      principal: 1_000_000,
      outstandingPrincipal: 800_000,
      couponRate: 5.5,
      nextPaymentAt: new Date(),
    };
    const r = redactPrivateBondRow(bond as never);
    expect((r as Record<string, unknown>).maturityTurns).toBe(240);
    expect((r as Record<string, unknown>).ratingAtIssuance).toBe("BBB");
    expect("principal" in r).toBe(false);
    expect("outstandingPrincipal" in r).toBe(false);
    expect("couponRate" in r).toBe(false);
    expect("nextPaymentAt" in r).toBe(false);
  });
});

/**
 * C2 REGRESSION. The plants tier added a whole PHYSICAL book to every sector
 * row (and a corp-level aggregate) and the redaction allowlists never grew to
 * cover it. `GET /api/corporations/[id]` returns the private payload BEFORE the
 * public fog-of-war pass runs, so an ANONYMOUS viewer of a PRIVATE corp saw
 * exact capacity, production, sales, fill rate, construction in progress and
 * the full build queue — strictly more than the same viewer gets from a PUBLIC
 * corp, which is backwards. Under plants, revenue is capacity x mix price, so
 * publishing capacity also un-redacts the revenue this list already strips.
 */
describe("redaction covers the plants-tier physical book", () => {
  const plantsRow = {
    _id: "s1",
    stateId: "US-CA",
    revenue: 1000,
    financialRevenue: 1000,
    realizedRevenue: 990,
    profitMargin: 12,
    currentGrowthCost: 5,
    workers: 10,
    capacityUnits: 5000,
    producedUnits: 4200,
    soldUnits: 1300,
    fillRate: 1300 / 4200,
    fillRateBand: "low",
    constructionInProgressAnchor: 250_000,
    buildQueueSummary: { orders: 2, unitsOrdered: 800, nextOnlineTurn: 1200, turnsRemaining: 4 },
    mothballed: false,
  };

  it("strips every physical figure from a private corp's sector row", () => {
    const r = redactPrivateSectorRow(plantsRow) as Record<string, unknown>;
    for (const field of [
      "capacityUnits",
      "producedUnits",
      "soldUnits",
      "fillRate",
      "fillRateBand",
      "constructionInProgressAnchor",
      "buildQueueSummary",
    ]) {
      expect(field in r).toBe(false);
    }
  });

  it("keeps the non-financial identity fields a private row is allowed to show", () => {
    const r = redactPrivateSectorRow(plantsRow) as Record<string, unknown>;
    expect(r._id).toBe("s1");
    expect(r.stateId).toBe("US-CA");
    expect(r.mothballed).toBe(false);
  });

  it("strips the corp-level physical aggregate", () => {
    const corp = {
      name: "Acme",
      liquidCapital: 5_000_000,
      physical: {
        capacityUnits: 50_000,
        producedUnits: 42_000,
        soldUnits: 13_000,
        fillRate: 0.31,
        constructionInProgressAnchor: 900_000,
        unitsOnOrder: 8_000,
      },
    };
    const r = redactPrivateCorporation(corp) as Record<string, unknown>;
    expect(r.name).toBe("Acme");
    expect("physical" in r).toBe(false);
    expect("liquidCapital" in r).toBe(false);
  });
});
