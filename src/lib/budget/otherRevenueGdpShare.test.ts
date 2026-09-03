/**
 * `otherRevenueGdpShareBaseline` — non-tax receipts track the size of the
 * economy rather than a figure frozen at seed time.
 *
 * `revenue.other` is the non-tax line: fees and dividends in a market economy,
 * the enterprise-surplus remittance that was the bulk of the state budget in a
 * Soviet-type one. It was authored as an ABSOLUTE, so it decays as a share of
 * any growing economy and breaks outright on a discontinuous GDP change. DD
 * authored DDM 4.5B against a DDM 50B GDP — a deliberate 9% share, in line with the
 * rest of the Warsaw Pact — then absorbed West Germany on turn 550 and carried
 * the same DDM 4.5B into a DDM 271B economy, where it was 1.5% (#1323).
 */
import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateFederalRevenue } from "./revenue";
import { calculateCountryOwnedBudgetRevenue } from "./publicEnterpriseRevenue";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./publicEnterpriseRevenue", () => ({
  calculateCountryOwnedBudgetRevenue: vi.fn().mockResolvedValue({ healthcareIncome: 0, other: 0 }),
}));
vi.mock("./spending", () => ({
  calculateFederalSpending: vi
    .fn()
    .mockResolvedValue({ byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 }),
}));
vi.mock("@/lib/era/context", () => ({
  getEraContext: vi.fn().mockResolvedValue({ year: 1953 }),
}));

const ZERO_RATES = {
  incomeTax: 0,
  domesticCorporateTax: 0,
  foreignCorporateTax: 0,
  payrollTax: 0,
  tariffs: 0,
  salesTax: 0,
};

/** Tax rates are all zero, so `revenue.total` isolates the `other` line. */
function budget(gdp: number, other: number, share?: number) {
  return {
    _id: "DD",
    countryId: "DD",
    gdp,
    revenue: { other },
    ...(share === undefined ? {} : { otherRevenueGdpShareBaseline: share }),
    taxBases: {
      taxableIncome: 0,
      domesticCorporateProfits: 0,
      foreignCorporateProfits: 0,
      wagesAndSalaries: 0,
      importValue: 0,
      taxableSales: 0,
    },
  };
}

describe("otherRevenueGdpShareBaseline", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(calculateCountryOwnedBudgetRevenue).mockResolvedValue({
      healthcareIncome: 0,
      other: 0,
    });
  });

  function wire(doc: unknown) {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue(doc),
    } as typeof db.collectionMocks.federalBudget;
    db.collectionMocks.enactedLaws = {
      ...db.collectionMocks.enactedLaws,
      find: vi.fn().mockImplementation(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    } as typeof db.collectionMocks.enactedLaws;
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
  }

  it("scales the non-tax line with GDP once a share is recorded", async () => {
    // DD's authored 9% share, carried onto the post-reunification economy.
    wire(budget(271_000_000_000, 4_500_000_000, 0.09));
    const revenue = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
    expect(revenue.other).toBeCloseTo(0.09 * 271_000_000_000, 0);
    // The stale absolute is what this replaces — it must NOT be what comes back.
    expect(revenue.other).toBeGreaterThan(4_500_000_000 * 5);
  });

  it("falls back to the persisted amount when no share is recorded", async () => {
    // Parity: an untouched budget that has never been healed is byte-identical.
    wire(budget(271_000_000_000, 4_500_000_000));
    const revenue = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
    expect(revenue.other).toBe(4_500_000_000);
  });

  it("ignores a share it cannot use rather than zeroing the line", async () => {
    // A malformed or zero share must not silently wipe non-tax revenue.
    for (const share of [0, -0.5, Number.NaN]) {
      wire(budget(271_000_000_000, 4_500_000_000, share));
      const revenue = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
      expect(revenue.other).toBe(4_500_000_000);
    }
  });

  it("ignores the share when GDP is unusable", async () => {
    wire(budget(0, 4_500_000_000, 0.09));
    const revenue = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
    expect(revenue.other).toBe(4_500_000_000);
  });

  it("holds the share steady as the economy grows", async () => {
    // The property that matters: the same share on a bigger economy yields a
    // proportionately bigger line, so the ratio never decays.
    wire(budget(50_000_000_000, 4_500_000_000, 0.09));
    const small = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
    wire(budget(500_000_000_000, 4_500_000_000, 0.09));
    const large = await calculateFederalRevenue(db as unknown as Db, ZERO_RATES, "DD");
    expect(small.other / 50_000_000_000).toBeCloseTo(large.other / 500_000_000_000, 10);
  });
});
