import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildFyHistory, projectSovereign } from "./federalBudgetDetail";

// Revenue recompute is independent of the fiscal-year derivation under test.
vi.mock("@/lib/budget/revenue", () => ({
  calculateFederalRevenue: vi.fn().mockResolvedValue({ total: 1_000_000 }),
}));

describe("buildFyHistory", () => {
  it("assembles ascending fyHistory with the live year appended last", () => {
    const snaps = [
      {
        fiscalYear: 2025,
        budget: {
          revenue: { total: 11 },
          spending: { total: 12 },
          debtToGdpRatio: 0.72,
          gdp: 104,
          creditRating: "A",
        },
      },
      {
        fiscalYear: 2024,
        budget: {
          revenue: { total: 10 },
          spending: { total: 12 },
          debtToGdpRatio: 0.7,
          gdp: 100,
          creditRating: "A",
        },
      },
    ];
    const live = {
      fiscalYear: 2026,
      revenue: { total: 12 },
      spending: { total: 13 },
      debtToGdpRatio: 0.74,
      gdp: 108,
      creditRating: "A",
    };
    const h = buildFyHistory(snaps as never, live as never);
    expect(h.map((x) => x.fy)).toEqual([2024, 2025, 2026]);
    expect(h[2]).toMatchObject({
      fy: 2026,
      revenue: 12,
      spending: 13,
      debtToGdp: 0.74,
      gdp: 108,
      rating: "A",
    });
  });

  it("prefers the live year over a snapshot for the same fiscal year (no dup)", () => {
    const snaps = [
      {
        fiscalYear: 2026,
        budget: {
          revenue: { total: 99 },
          spending: { total: 99 },
          debtToGdpRatio: 0.9,
          gdp: 1,
          creditRating: "BBB",
        },
      },
    ];
    const live = {
      fiscalYear: 2026,
      revenue: { total: 12 },
      spending: { total: 13 },
      debtToGdpRatio: 0.74,
      gdp: 108,
      creditRating: "A",
    };
    const h = buildFyHistory(snaps as never, live as never);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ fy: 2026, revenue: 12, rating: "A" });
  });
});

describe("projectSovereign", () => {
  it("defaults to normal / open when no sovereign fields are present", () => {
    expect(projectSovereign({}, 100)).toMatchObject({
      state: "normal",
      demandRatio: null,
      failedAuctions: 0,
      marketAccess: "Open",
    });
  });

  it("projects the live signals and a market-access lock vs current turn", () => {
    expect(
      projectSovereign(
        {
          sovereignCrisisState: "warning",
          lastAuctionDemandRatio: 1.8,
          failedAuctionConsecutiveCount: 1,
          marketAccessLockedUntilTurn: 200,
        },
        100
      )
    ).toMatchObject({
      state: "warning",
      demandRatio: 1.8,
      failedAuctions: 1,
      marketAccess: "Locked",
    });
  });

  it("treats an elapsed lock turn as open", () => {
    expect(projectSovereign({ marketAccessLockedUntilTurn: 50 }, 100).marketAccess).toBe("Open");
  });
});

describe("loadFederalBudgetDetail — fiscal year is preset-aware", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("federalBudget");
    db.collection("gameState");
    db.collectionMocks.federalBudget!.findOne.mockResolvedValue({
      _id: "IE",
      countryId: "IE",
      taxRates: {},
      revenue: { total: 1_000_000 },
      spending: { byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 },
      debt: { principal: 0, interestRate: 0 },
      gdp: 34_000_000_000,
      currencyCode: "EUR",
    });
  });

  async function loadIE() {
    const { loadFederalBudgetDetail } = await import("./federalBudgetDetail");
    return loadFederalBudgetDetail({
      db: db as unknown as Db,
      countryId: "IE" as CountryId,
      requestUrl: "http://localhost/api/country/ie/budget/federal",
    });
  }

  it("prefers the engine-maintained gameState.currentYear (1991 world at turn 99 -> FY1993)", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 99,
      currentYear: 1993,
      startingYear: 2019, // deliberately inconsistent — currentYear must win
      preset: "1991-default",
    });
    const result = await loadIE();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.budget.fiscalYear).toBe(1993);
  });

  it("falls back to startingYear + elapsed years when currentYear is absent: turn 99 -> FY1993", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 99,
      startingYear: 1991,
    });
    const result = await loadIE();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.budget.fiscalYear).toBe(1993);
  });

  it("falls back to STARTING_YEAR (2019) when both fields are absent (legacy row): turn 99 -> FY2021", async () => {
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 99,
    });
    const result = await loadIE();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.budget.fiscalYear).toBe(2021);
  });
});
