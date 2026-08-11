import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("../../bondMutations/repudiate", () => ({
  markCountryBondsRepudiated: vi.fn().mockResolvedValue({ bondsAffected: 5 }),
}));
vi.mock("../../sideEffects/trustHit", () => ({
  applyCrossCountryTrustHit: vi.fn().mockResolvedValue({ statesUpdated: 50 }),
}));
vi.mock("../../sideEffects/fxDepreciation", () => ({
  applyExchangeRateDepreciation: vi
    .fn()
    .mockResolvedValue({ ok: true, previousRate: 1, newRate: 1.4 }),
}));
vi.mock("../../crisisNews", () => ({
  emitRepudiatedNews: vi.fn().mockResolvedValue(undefined),
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
// orchestrator) and exercised by their own unit tests. Mock them at the
// module boundary so this test stays focused on state-machine + bond mutations
// and doesn't need to stub @/lib/news, stateMetrics, governmentFormations, etc.
vi.mock("../../political/civilUnrestEvents", () => ({
  emitCivilUnrestEvents: vi.fn().mockResolvedValue({ eventsEmitted: 0 }),
}));
vi.mock("../../political/triggerSystemNoConfidence", () => ({
  triggerSystemNoConfidence: vi.fn().mockResolvedValue({ triggered: false }),
}));
vi.mock("../../political/executivePoliticalImpact", () => ({
  applyExecutivePoliticalImpact: vi.fn().mockResolvedValue({ applied: false }),
}));

import { applyRepudiateResolution } from "../repudiate";
import { markCountryBondsRepudiated } from "../../bondMutations/repudiate";
import { applyCrossCountryTrustHit } from "../../sideEffects/trustHit";
import { applyExchangeRateDepreciation } from "../../sideEffects/fxDepreciation";
import { emitRepudiatedNews } from "../../crisisNews";
import {
  REPUDIATE_TRUST_HIT,
  REPUDIATE_FX_DEPRECIATION,
  REPUDIATE_LOCKOUT_TURNS,
  REPUDIATE_GDP_PENALTY,
  REPUDIATE_GDP_PENALTY_TURNS,
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

describe("applyRepudiateResolution — guards", () => {
  it("returns no-budget when federalBudget missing", async () => {
    const { db } = makeMockDb(null);
    const r = await applyRepudiateResolution(db, {
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
    const r = await applyRepudiateResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not-in-crisisPending");
  });

  it("accepts crisisResolving state for legislative-ratification path (phase 9b)", async () => {
    const { db, sets } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisResolving",
    });
    const r = await applyRepudiateResolution(db, {
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

describe("applyRepudiateResolution — happy path", () => {
  it("flips bonds, applies trust + FX, transitions to recovering, ratifies, emits news", async () => {
    const { db, sets, decisionUpdates } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });

    const decisionId = new ObjectId();
    const r = await applyRepudiateResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId,
      executiveCharacterId: null,
    });

    expect(r.ok).toBe(true);
    expect(r.bondsAffected).toBe(5);

    expect(markCountryBondsRepudiated).toHaveBeenCalledWith(db, "US", 600);
    expect(applyCrossCountryTrustHit).toHaveBeenCalledWith(db, "US", REPUDIATE_TRUST_HIT);
    expect(applyExchangeRateDepreciation).toHaveBeenCalledWith(db, "US", REPUDIATE_FX_DEPRECIATION);

    const s = sets[0];
    expect(s.sovereignCrisisState).toBe("recovering");
    expect(s.crisisChoice).toBe("repudiate");
    expect(s.recoveryStartedAt).toEqual({ turn: 600 });
    expect(s.lastDefaultTurn).toBe(600);
    expect(s.recoveryFiscalDisciplineStreak).toBe(0);
    expect(s.marketAccessLockedUntilTurn).toBe(600 + REPUDIATE_LOCKOUT_TURNS);
    expect(s.recoveryGdpPenaltyPercent).toBe(REPUDIATE_GDP_PENALTY);
    expect(s.recoveryGdpPenaltyTurnsRemaining).toBe(REPUDIATE_GDP_PENALTY_TURNS);
    expect(s.creditRating).toBe("CCC");
    expect(s.crisisAutoActionAt).toBe(null);

    expect(decisionUpdates[0].state).toBe("ratified");
    expect(decisionUpdates[0].executiveChoice).toBe("repudiate");
    expect(emitRepudiatedNews).toHaveBeenCalledWith("US", 600, 5);
  });
});

describe("applyRepudiateResolution — cascade (phase 7)", () => {
  it("runs cascade with reason 'repudiate' after marking bonds", async () => {
    const { runCascade } = await import("../../cascade/cascadeOrchestrator");
    const { emitCascadeSummaryNews } = await import("../../cascade/cascadeNews");
    vi.mocked(runCascade).mockClear();
    vi.mocked(emitCascadeSummaryNews).mockClear();

    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    await applyRepudiateResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(runCascade).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(runCascade).mock.calls[0][1];
    expect(callArgs.reason).toBe("repudiate");
    expect(callArgs.currentTurn).toBe(600);
    expect(emitCascadeSummaryNews).toHaveBeenCalledWith("US", expect.any(Object));
  });

  it("emits mass-cascade alert when totalCorpsInsolvent > 5", async () => {
    const { runCascade } = await import("../../cascade/cascadeOrchestrator");
    const { emitMassCascadeAlert } = await import("../../cascade/cascadeNews");
    vi.mocked(emitMassCascadeAlert).mockClear();
    vi.mocked(runCascade).mockResolvedValueOnce({
      levels: 2,
      totalBondsCascaded: 20,
      totalCorpsInsolvent: 7,
      perLevelReports: [],
      insolventCorpIdsByLevel: [],
    });

    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    await applyRepudiateResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(emitMassCascadeAlert).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      7,
      expect.any(Number)
    );
  });
});
