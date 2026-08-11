import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/bonds/sovereign", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/bonds/sovereign")>();
  return {
    ...actual,
    calculateSovereignRolloverAmount: vi.fn(),
  };
});
vi.mock("../../sideEffects/fxDepreciation", () => ({
  applyExchangeRateDepreciation: vi
    .fn()
    .mockResolvedValue({ ok: true, previousRate: 1, newRate: 1.05 }),
}));
vi.mock("../../crisisNews", () => ({
  emitMonetizedNews: vi.fn().mockResolvedValue(undefined),
}));
// Phase 11b political side-effects are best-effort (try/catch in the
// orchestrator) and exercised by their own unit tests. Mock at the module
// boundary so this test stays focused on monetize-specific logic.
vi.mock("../../political/civilUnrestEvents", () => ({
  emitCivilUnrestEvents: vi.fn().mockResolvedValue({ eventsEmitted: 0 }),
}));
vi.mock("../../political/triggerSystemNoConfidence", () => ({
  triggerSystemNoConfidence: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock("../../political/executivePoliticalImpact", () => ({
  applyExecutivePoliticalImpact: vi.fn().mockResolvedValue({ applied: false }),
}));

import { applyMonetizeResolution } from "../monetize";
import { calculateSovereignRolloverAmount } from "@/lib/bonds/sovereign";
import { applyExchangeRateDepreciation } from "../../sideEffects/fxDepreciation";
import { emitMonetizedNews } from "../../crisisNews";
import { MONETIZE_GATE_INFLATION, INFLATION_SHOCK_MULTIPLIER } from "../../constants";

interface BudgetRow {
  _id: string;
  countryId: string;
  sovereignCrisisState?: string;
  surplus?: number;
  gdp?: number;
  economicFactors?: { inflationRate: number };
}

function makeMockDb(initial: BudgetRow | null) {
  const sets: Array<Record<string, unknown>> = [];
  const decisionUpdates: Array<Record<string, unknown>> = [];
  let row = initial ? { ...initial } : null;
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "federalBudget") {
        return {
          findOne: vi.fn().mockResolvedValue(row),
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            sets.push(u.$set as Record<string, unknown>);
            row = row ? { ...row, ...(u.$set as object) } : null;
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "sovereignCrisisDecisions") {
        return {
          findOne: vi.fn().mockResolvedValue({ proposingCharacterId: null }),
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            decisionUpdates.push(u.$set as Record<string, unknown>);
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "characters") {
        return {
          updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, sets, decisionUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(calculateSovereignRolloverAmount).mockReset();
});

describe("applyMonetizeResolution — guards", () => {
  it("returns no-budget when federalBudget missing", async () => {
    const { db } = makeMockDb(null);
    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-budget");
  });

  it("returns not-in-crisisPending when state is not crisisPending", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
    });
    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.reason).toBe("not-in-crisisPending");
  });

  it("accepts crisisResolving state for legislative-ratification path (phase 9b)", async () => {
    const { db, sets } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisResolving",
      economicFactors: { inflationRate: 3.0 },
      surplus: 0,
      gdp: 27_000_000_000_000,
    });
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(0);
    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(true);
    expect(sets[0].sovereignCrisisState).toBe("recovering");
  });

  it("returns monetize-gated-by-inflation when current inflation > 8%", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
      economicFactors: { inflationRate: 9.0 },
    });
    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("monetize-gated-by-inflation");
  });

  it("at exactly 8% inflation, gate does not fire (allows monetize)", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
      economicFactors: { inflationRate: MONETIZE_GATE_INFLATION * 100 },
      surplus: 0,
      gdp: 27_000_000_000_000,
    });
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(0);
    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(true);
  });
});

describe("applyMonetizeResolution — happy path", () => {
  it("computes printedAmount and inflation shock, applies FX coupling, transitions", async () => {
    const { db, sets, decisionUpdates } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
      economicFactors: { inflationRate: 3.0 },
      surplus: -800_000_000_000,
      gdp: 27_000_000_000_000,
    });
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(1_500_000_000_000);

    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });

    expect(r.ok).toBe(true);
    expect(r.printedAmount).toBe(2_300_000_000_000);
    expect(r.inflationShockPp).toBeCloseTo((2.3 / 27) * INFLATION_SHOCK_MULTIPLIER * 100, 1);

    const s = sets[0];
    expect(s.sovereignCrisisState).toBe("recovering");
    expect(s.crisisChoice).toBe("monetize");
    expect(s.recoveryGdpPenaltyPercent).toBe(null);
    expect(s.recoveryGdpPenaltyTurnsRemaining).toBe(null);
    expect(s.marketAccessLockedUntilTurn).toBe(null);
    expect(s["economicFactors.inflationRate"]).toBeCloseTo(3.0 + r.inflationShockPp!, 1);

    const expectedFxFraction = (2.3 / 27) * INFLATION_SHOCK_MULTIPLIER * 0.4;
    expect(applyExchangeRateDepreciation).toHaveBeenCalledWith(
      db,
      "US",
      expect.closeTo(expectedFxFraction, 4)
    );

    expect(decisionUpdates[0].executiveChoice).toBe("monetize");
    expect(emitMonetizedNews).toHaveBeenCalled();
  });

  it("with surplus + zero rollover, prints zero and does no inflation/FX work", async () => {
    const { db, sets } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
      economicFactors: { inflationRate: 2.0 },
      surplus: 100_000_000_000,
      gdp: 27_000_000_000_000,
    });
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(0);

    const r = await applyMonetizeResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.printedAmount).toBe(0);
    expect(r.inflationShockPp).toBe(0);
    expect(applyExchangeRateDepreciation).not.toHaveBeenCalled();
    expect(sets[0]["economicFactors.inflationRate"]).toBe(2.0);
  });
});
