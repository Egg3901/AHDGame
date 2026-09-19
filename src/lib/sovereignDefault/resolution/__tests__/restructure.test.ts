import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("../../bondMutations/restructure", () => ({
  applyCountryBondRestructure: vi.fn().mockResolvedValue({ bondsAffected: 8 }),
}));
vi.mock("../../sideEffects/trustHit", () => ({
  applyCrossCountryTrustHit: vi.fn().mockResolvedValue({ statesUpdated: 50 }),
}));
vi.mock("../../sideEffects/fxDepreciation", () => ({
  applyExchangeRateDepreciation: vi
    .fn()
    .mockResolvedValue({ ok: true, previousRate: 1, newRate: 1.15 }),
}));
vi.mock("../../crisisNews", () => ({
  emitRestructuredNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../cascade/cascadeOrchestrator", () => ({
  runCascade: vi.fn().mockResolvedValue({
    levels: 1,
    totalBondsCascaded: 5,
    totalCorpsInsolvent: 0,
    perLevelReports: [],
    insolventCorpIdsByLevel: [],
  }),
}));
vi.mock("../../cascade/cascadeNews", () => ({
  emitCascadeSummaryNews: vi.fn().mockResolvedValue(undefined),
  emitMassCascadeAlert: vi.fn().mockResolvedValue(undefined),
}));
// Phase 11b political side-effects are best-effort (try/catch in the
// orchestrator) and exercised by their own unit tests. Mock at the module
// boundary so this test stays focused on restructure-specific logic.
vi.mock("../../political/civilUnrestEvents", () => ({
  emitCivilUnrestEvents: vi.fn().mockResolvedValue({ eventsEmitted: 0 }),
}));
vi.mock("../../political/executivePoliticalImpact", () => ({
  applyExecutivePoliticalImpact: vi.fn().mockResolvedValue({ applied: false }),
}));

import { applyRestructureResolution } from "../restructure";
import { applyCountryBondRestructure } from "../../bondMutations/restructure";
import { applyCrossCountryTrustHit } from "../../sideEffects/trustHit";
import { applyExchangeRateDepreciation } from "../../sideEffects/fxDepreciation";
import { emitRestructuredNews } from "../../crisisNews";
import {
  RESTRUCTURE_HAIRCUT,
  RESTRUCTURE_MATURITY_EXTENSION_TURNS,
  RESTRUCTURE_TRUST_HIT,
  RESTRUCTURE_FX_DEPRECIATION,
  RESTRUCTURE_LOCKOUT_TURNS,
  RESTRUCTURE_GDP_PENALTY,
  RESTRUCTURE_GDP_PENALTY_TURNS,
} from "../../constants";

interface BudgetRow {
  _id: string;
  countryId: string;
  sovereignCrisisState?: string;
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
      if (name === "bonds") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, sets, decisionUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyRestructureResolution — guards", () => {
  it("returns no-budget when federalBudget missing", async () => {
    const { db } = makeMockDb(null);
    const r = await applyRestructureResolution(db, {
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
    const r = await applyRestructureResolution(db, {
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
    });
    const r = await applyRestructureResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(true);
    expect(sets[0].sovereignCrisisState).toBe("recovering");
  });
});

describe("applyRestructureResolution — happy path", () => {
  it("restructures bonds, applies trust + FX, transitions, ratifies, emits news", async () => {
    const { db, sets, decisionUpdates } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    const r = await applyRestructureResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(true);
    expect(r.bondsAffected).toBe(8);
    expect(applyCountryBondRestructure).toHaveBeenCalledWith(
      db,
      "US",
      RESTRUCTURE_HAIRCUT,
      RESTRUCTURE_MATURITY_EXTENSION_TURNS
    );
    expect(applyCrossCountryTrustHit).toHaveBeenCalledWith(db, "US", RESTRUCTURE_TRUST_HIT);
    expect(applyExchangeRateDepreciation).toHaveBeenCalledWith(
      db,
      "US",
      RESTRUCTURE_FX_DEPRECIATION
    );

    const s = sets[0];
    expect(s.sovereignCrisisState).toBe("recovering");
    expect(s.crisisChoice).toBe("restructure");
    expect(s.marketAccessLockedUntilTurn).toBe(600 + RESTRUCTURE_LOCKOUT_TURNS);
    expect(s.recoveryGdpPenaltyPercent).toBe(RESTRUCTURE_GDP_PENALTY);
    expect(s.recoveryGdpPenaltyTurnsRemaining).toBe(RESTRUCTURE_GDP_PENALTY_TURNS);
    expect(s.creditRating).toBe("B");
    expect(decisionUpdates[0].executiveChoice).toBe("restructure");
    expect(emitRestructuredNews).toHaveBeenCalledWith("US", 600, RESTRUCTURE_HAIRCUT, 8);
  });
});

describe("applyRestructureResolution — cascade (phase 7)", () => {
  it("runs cascade with reason 'restructure' after stamping bonds", async () => {
    const { runCascade } = await import("../../cascade/cascadeOrchestrator");
    const { emitCascadeSummaryNews } = await import("../../cascade/cascadeNews");
    vi.mocked(runCascade).mockClear();
    vi.mocked(emitCascadeSummaryNews).mockClear();

    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    await applyRestructureResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(runCascade).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(runCascade).mock.calls[0][1];
    expect(callArgs.reason).toBe("restructure");
    expect(emitCascadeSummaryNews).toHaveBeenCalled();
  });
});
