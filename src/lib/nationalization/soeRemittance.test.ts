import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/budget/publicEnterpriseRevenue", () => ({
  estimateNationalizedOperatingIncome: vi.fn(),
  // The remittance now resolves the plants context the same way the budget
  // revenue line does; below plants it is the inert default.
  loadPlantsBudgetContext: vi
    .fn()
    .mockResolvedValue({ plantsEnabled: false, currentTurn: null, rampTurns: 12 }),
}));
vi.mock("./treasury", () => ({ remitToTreasury: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: vi.fn(() => "CNY"),
  fxRateForCorpFromMap: vi.fn(() => 1),
  anchorToCorpCapital: vi.fn((v: number) => v), // identity at rate 1
}));

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) };
}

const now = new Date("2026-06-03T00:00:00Z");

describe("processSoeRemittance", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  function seed(retentionPercent: number, liquidCapital = 1_000_000_000) {
    db = createMockDb();
    for (const n of ["corporations", "corporateSectors", "stateMetrics", "centralBanks"])
      db.collection(n);
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: corpId,
          countryId: "CN",
          countryOwnerId: "CN",
          ownershipState: "stateOwned",
          liquidCurrencyCode: "CNY",
          profitRetentionPercent: retentionPercent,
          liquidCapital,
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        { _id: new ObjectId(), corporationId: corpId, stateId: "HD", sectorType: "technology" },
      ])
    );
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("remits (1 - retention) of operating profit and retains the rest", async () => {
    seed(40);
    const { estimateNationalizedOperatingIncome } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000); // ₳ → local 1000 (rate 1)
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    // 1000 × (1 - 0.40) = 600 remitted; 400 stays in liquidCapital.
    expect(vi.mocked(remitToTreasury)).toHaveBeenCalledWith(
      db,
      { countryId: "CN", corpId, amountLocal: 600 },
      now
    );
  });

  it("remits exactly the 25% floor at max retention (75%)", async () => {
    seed(75);
    const { estimateNationalizedOperatingIncome } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    expect(vi.mocked(remitToTreasury)).toHaveBeenCalledWith(
      db,
      { countryId: "CN", corpId, amountLocal: 250 },
      now
    );
  });

  it("does not remit on an operating loss (handled by processSoeOperations)", async () => {
    seed(40);
    const { estimateNationalizedOperatingIncome } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(-500);
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    expect(vi.mocked(remitToTreasury)).not.toHaveBeenCalled();
  });

  it("caps remittance at available liquidCapital — never overdraws an SOE", async () => {
    // Estimate says profit (remit 600), but the SOE only holds 100 in cash.
    seed(40, 100);
    const { estimateNationalizedOperatingIncome } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    // Remits only what's actually on hand (100), not the estimated 600.
    expect(vi.mocked(remitToTreasury)).toHaveBeenCalledWith(
      db,
      { countryId: "CN", corpId, amountLocal: 100 },
      now
    );
  });

  it("does not remit when the SOE has no liquid cash, even on a positive estimate", async () => {
    // Loss-backed to zero this turn: estimate is optimistic but there is no cash.
    seed(40, 0);
    const { estimateNationalizedOperatingIncome } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    expect(vi.mocked(remitToTreasury)).not.toHaveBeenCalled();
  });

  // ── Plants parity with the budget revenue line ───────────────────────────
  // `estimateNationalizedOperatingIncome` takes `plantsEnabled` and the ramp
  // POSITIONALLY and both default to the pre-plants behaviour, so a four-argument
  // call silently priced the swept cash off the WRONG cost model while the budget
  // line priced its own number off the plants one. These pin the argument shape.

  it("below plants, passes the inert plants context (byte-identical estimate call)", async () => {
    seed(40);
    const { estimateNationalizedOperatingIncome, loadPlantsBudgetContext } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(loadPlantsBudgetContext).mockResolvedValue({
      plantsEnabled: false,
      currentTurn: null,
      rampTurns: 12,
    });
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    const call = vi.mocked(estimateNationalizedOperatingIncome).mock.calls[0];
    expect(call[4]).toBe(1); // concentration multiplier: identity, unchanged
    expect(call[5]).toBe(false); // plantsEnabled
  });

  it("under plants, threads the SAME plants context the budget revenue line uses", async () => {
    seed(40);
    const ctx = { plantsEnabled: true, currentTurn: 980, rampTurns: 24 };
    const { estimateNationalizedOperatingIncome, loadPlantsBudgetContext } =
      await import("@/lib/budget/publicEnterpriseRevenue");
    vi.mocked(loadPlantsBudgetContext).mockResolvedValue(ctx);
    vi.mocked(estimateNationalizedOperatingIncome).mockReturnValue(1000);
    const { remitToTreasury } = await import("./treasury");

    const { processSoeRemittance } = await import("./soeRemittance");
    await processSoeRemittance(db as unknown as Db, now);

    const call = vi.mocked(estimateNationalizedOperatingIncome).mock.calls[0];
    expect(call[5]).toBe(true); // plantsEnabled reaches the helper
    expect(call[6]).toEqual(ctx); // ramp inputs reach the idle-upkeep mirror

    // And the cash actually swept is (1 − retention) of THAT income — the same
    // quantity `calculateCountryOwnedBudgetRevenue` books as the revenue line.
    expect(vi.mocked(remitToTreasury)).toHaveBeenCalledWith(
      db,
      { countryId: "CN", corpId, amountLocal: 600 },
      now
    );
  });
});
