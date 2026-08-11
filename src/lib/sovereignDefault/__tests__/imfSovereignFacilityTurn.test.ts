import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/imf/resolveImfCorporation", () => ({
  getImfCorporation: vi.fn(),
}));

import { processSovereignImfFacilityPayments } from "../imfSovereignFacilityTurn";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";

const IMF_ID = new ObjectId();

interface Row {
  _id: string;
  countryId: string;
  imfSovereignBailoutActive?: boolean;
  imfSovereignFacilityPrincipalOutstanding?: number;
  imfSovereignFacilityAnnualRate?: number;
  imfSovereignFacilityAmortizationTurnsRemaining?: number;
  imfSovereignFacilityIncomeCaptureFraction?: number;
  revenue?: { total: number };
}

function makeMockDb(rows: Row[]) {
  let active = [...rows];
  const sets: Array<{ id: string; $set: Record<string, unknown> }> = [];
  const imfIncs: number[] = [];
  const budgetIncs: Array<{ id: string; $inc: Record<string, unknown> }> = [];
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "federalBudget") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(active.filter((r) => r.imfSovereignBailoutActive)),
          }),
          updateOne: vi.fn(async (filter: { _id: string }, u: Record<string, unknown>) => {
            sets.push({ id: filter._id, $set: u.$set as Record<string, unknown> });
            if (u.$inc) {
              budgetIncs.push({ id: filter._id, $inc: u.$inc as Record<string, unknown> });
            }
            active = active.map((r) =>
              r._id === filter._id ? { ...r, ...(u.$set as object) } : r
            );
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "corporations") {
        return {
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            const inc = (u.$inc as { liquidCapital?: number } | undefined)?.liquidCapital;
            if (typeof inc === "number") imfIncs.push(inc);
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "exchangeRates") {
        // Empty FX list — loadFxRatesByCurrency falls through to the
        // pre-forex pass-through (rate=1 for both country and IMF Corp), so
        // payment = actualPayment unchanged, matching the original test
        // expectations.
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, sets, imfIncs, budgetIncs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getImfCorporation).mockReset();
});

describe("processSovereignImfFacilityPayments", () => {
  it("no-ops when IMF corp missing", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue(null);
    const { db } = makeMockDb([]);
    const r = await processSovereignImfFacilityPayments(db, 100);
    expect(r.paymentsApplied).toBe(0);
  });

  it("no-ops when no active sovereign facility", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    const { db, sets } = makeMockDb([
      { _id: "federal", countryId: "US", imfSovereignBailoutActive: false },
    ]);
    const r = await processSovereignImfFacilityPayments(db, 100);
    expect(r.paymentsApplied).toBe(0);
    expect(sets).toHaveLength(0);
  });

  it("applies payment, advances amortization, and credits IMF Corp", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    const { db, sets, imfIncs } = makeMockDb([
      {
        _id: "federal",
        countryId: "US",
        imfSovereignBailoutActive: true,
        imfSovereignFacilityPrincipalOutstanding: 1_000_000_000,
        imfSovereignFacilityAnnualRate: 6.0,
        imfSovereignFacilityAmortizationTurnsRemaining: 240,
        imfSovereignFacilityIncomeCaptureFraction: 0.2,
        revenue: { total: 4_800_000_000_000 },
      },
    ]);

    const r = await processSovereignImfFacilityPayments(db, 100);
    expect(r.paymentsApplied).toBe(1);
    expect(sets).toHaveLength(1);
    expect(sets[0].$set.imfSovereignFacilityPrincipalOutstanding).toBeLessThan(1_000_000_000);
    expect(sets[0].$set.imfSovereignFacilityAmortizationTurnsRemaining).toBeLessThan(240);
    expect(imfIncs.length).toBeGreaterThan(0);
    expect(imfIncs[0]).toBeGreaterThan(0);
  });

  it("increments imfSovereignFacilityCumulativePaidAnchor on each payment (Phase 11a)", async () => {
    // Regression: each successful payment should accumulate into the
    // per-budget cumulative-paid counter so the IMF page can display a
    // running tally of lifetime contributions per country.
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    const { db, budgetIncs } = makeMockDb([
      {
        _id: "federal",
        countryId: "US",
        imfSovereignBailoutActive: true,
        imfSovereignFacilityPrincipalOutstanding: 1_000_000_000,
        imfSovereignFacilityAnnualRate: 6.0,
        imfSovereignFacilityAmortizationTurnsRemaining: 240,
        imfSovereignFacilityIncomeCaptureFraction: 0.2,
        revenue: { total: 4_800_000_000_000 },
      },
    ]);
    await processSovereignImfFacilityPayments(db, 100);
    // The budget update should have included a $inc on the cumulative
    // counter equal to the paymentAnchor (positive).
    expect(budgetIncs.length).toBe(1);
    const inc = budgetIncs[0].$inc.imfSovereignFacilityCumulativePaidAnchor as number;
    expect(typeof inc).toBe("number");
    expect(inc).toBeGreaterThan(0);
  });

  it("does not increment cumulative counter when no payment is made", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    const { db, budgetIncs } = makeMockDb([
      {
        _id: "federal",
        countryId: "US",
        imfSovereignBailoutActive: true,
        imfSovereignFacilityPrincipalOutstanding: 0.0000001, // ~zero, skipped
        imfSovereignFacilityAnnualRate: 6.0,
        imfSovereignFacilityAmortizationTurnsRemaining: 240,
        imfSovereignFacilityIncomeCaptureFraction: 0.2,
        revenue: { total: 1_000_000_000_000 },
      },
    ]);
    await processSovereignImfFacilityPayments(db, 100);
    expect(budgetIncs.length).toBe(0);
  });

  it("clears imfSovereignBailoutActive when principal reaches ~0", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    const { db, sets } = makeMockDb([
      {
        _id: "federal",
        countryId: "US",
        imfSovereignBailoutActive: true,
        imfSovereignFacilityPrincipalOutstanding: 1,
        imfSovereignFacilityAnnualRate: 6.0,
        imfSovereignFacilityAmortizationTurnsRemaining: 1,
        imfSovereignFacilityIncomeCaptureFraction: 0.2,
        revenue: { total: 1_000_000_000_000 },
      },
    ]);

    const r = await processSovereignImfFacilityPayments(db, 100);
    expect(r.paymentsApplied).toBe(1);
    expect(sets[0].$set.imfSovereignBailoutActive).toBe(false);
    expect(sets[0].$set.imfSovereignFacilityPrincipalOutstanding).toBe(0);
  });

  it("when income cap binds, does not advance amortization", async () => {
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_ID } as never);
    // Tiny revenue can't cover scheduled payment → cap binds, principal grows or holds
    const { db, sets } = makeMockDb([
      {
        _id: "federal",
        countryId: "US",
        imfSovereignBailoutActive: true,
        imfSovereignFacilityPrincipalOutstanding: 10_000_000_000,
        imfSovereignFacilityAnnualRate: 6.0,
        imfSovereignFacilityAmortizationTurnsRemaining: 240,
        imfSovereignFacilityIncomeCaptureFraction: 0.2,
        revenue: { total: 100_000_000 },
      },
    ]);

    const r = await processSovereignImfFacilityPayments(db, 100);
    expect(r.paymentsApplied).toBeGreaterThanOrEqual(0);
    expect(sets[0].$set.imfSovereignFacilityAmortizationTurnsRemaining).toBe(240);
  });
});
