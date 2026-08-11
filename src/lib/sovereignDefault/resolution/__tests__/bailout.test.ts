import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/imf/resolveImfCorporation", () => ({
  getImfCorporation: vi.fn(),
}));
vi.mock("@/lib/bonds/sovereign", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/bonds/sovereign")>();
  return {
    ...actual,
    calculateSovereignRolloverAmount: vi.fn(),
  };
});
vi.mock("../../crisisNews", () => ({
  emitBailoutGrantedNews: vi.fn().mockResolvedValue(undefined),
}));
// Phase 11b political side-effects are best-effort (try/catch in the
// orchestrator) and exercised by their own unit tests. Mock at the module
// boundary so this test stays focused on bailout-specific logic.
vi.mock("../../political/civilUnrestEvents", () => ({
  emitCivilUnrestEvents: vi.fn().mockResolvedValue({ eventsEmitted: 0 }),
}));
vi.mock("../../political/executivePoliticalImpact", () => ({
  applyExecutivePoliticalImpact: vi.fn().mockResolvedValue({ applied: false }),
}));

import { applyBailoutResolution } from "../bailout";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { calculateSovereignRolloverAmount } from "@/lib/bonds/sovereign";
import { emitBailoutGrantedNews } from "../../crisisNews";

const IMF_CORP_ID = new ObjectId();

interface BudgetRow {
  _id: string;
  countryId: string;
  sovereignCrisisState?: string;
  surplus?: number;
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
          // Phase 11b: orchestrators read the decision to look up the
          // proposingCharacterId for the political-impact hit.
          findOne: vi.fn().mockResolvedValue({ proposingCharacterId: null }),
          updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
            decisionUpdates.push(u.$set as Record<string, unknown>);
            return { acknowledged: true, modifiedCount: 1 };
          }),
        };
      }
      if (name === "characters") {
        // Phase 11b political-impact applier — no-op when proposingCharacterId
        // is null, but the orchestrator still calls db.collection("characters").
        return {
          updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, getRow: () => row, sets, decisionUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getImfCorporation).mockReset();
  vi.mocked(calculateSovereignRolloverAmount).mockReset();
});

describe("applyBailoutResolution — guards", () => {
  it("returns no-budget when federalBudget missing", async () => {
    const { db } = makeMockDb(null);
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    const r = await applyBailoutResolution(db, {
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
    const { db, sets } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "normal",
    });
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    const r = await applyBailoutResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not-in-crisisPending");
    expect(sets).toHaveLength(0);
  });

  it("returns no-imf-corp when IMF Corp does not exist", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
    });
    vi.mocked(getImfCorporation).mockResolvedValue(null);
    const r = await applyBailoutResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-imf-corp");
  });

  it("accepts crisisResolving state for legislative-ratification path (phase 9b)", async () => {
    const { db, sets } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisResolving",
      surplus: -800_000_000_000,
    });
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(1_500_000_000_000);

    const r = await applyBailoutResolution(db, {
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

describe("applyBailoutResolution — happy path", () => {
  it("writes facility fields, transitions to recovering, ratifies decision, emits news", async () => {
    const { db, sets, decisionUpdates } = makeMockDb({
      _id: "federal",
      countryId: "US",
      sovereignCrisisState: "crisisPending",
      surplus: -800_000_000_000,
    });
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(1_500_000_000_000);

    const decisionId = new ObjectId();
    const r = await applyBailoutResolution(db, {
      countryCode: "US",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId,
      executiveCharacterId: null,
    });

    expect(r.ok).toBe(true);
    expect(r.termsApplied?.principal).toBe(2_300_000_000_000);
    expect(sets).toHaveLength(1);
    const s = sets[0];
    expect(s.imfSovereignBailoutActive).toBe(true);
    expect(s.imfSovereignFacilityPrincipalOutstanding).toBe(2_300_000_000_000);
    expect(s.imfSovereignFacilityImfCorporationId).toEqual(IMF_CORP_ID);
    expect(s.sovereignCrisisState).toBe("recovering");
    expect(s.recoveryStartedAt).toEqual({ turn: 600 });
    expect(s.lastDefaultTurn).toBe(600);
    expect(s.recoveryFiscalDisciplineStreak).toBe(0);
    expect(s.crisisChoice).toBe("bailout");
    expect(s.crisisChoiceAt).toEqual({ turn: 600, realtimeMs: 1_700_000_000_000 });
    expect(s.imfBoardOverrideWindowEndAt).toEqual({
      turn: 600 + 12,
      realtimeMs: 1_700_000_000_000 + 12 * 3_600_000,
    });
    expect(s.crisisAutoActionAt).toBe(null);

    expect(decisionUpdates).toHaveLength(1);
    expect(decisionUpdates[0].state).toBe("ratified");
    expect(decisionUpdates[0].executiveChoice).toBe("bailout");

    expect(emitBailoutGrantedNews).toHaveBeenCalledWith("US", 600, 2_300_000_000_000);
  });

  it("uses 0 deficit when surplus is positive (surplus country)", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "DE",
      sovereignCrisisState: "crisisPending",
      surplus: 100_000_000_000,
    });
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(500_000_000_000);

    const r = await applyBailoutResolution(db, {
      countryCode: "DE",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.termsApplied?.principal).toBe(500_000_000_000);
  });

  it("principal can be 0 when both inputs are 0", async () => {
    const { db } = makeMockDb({
      _id: "federal",
      countryId: "DE",
      sovereignCrisisState: "crisisPending",
      surplus: 0,
    });
    vi.mocked(getImfCorporation).mockResolvedValue({ _id: IMF_CORP_ID } as never);
    vi.mocked(calculateSovereignRolloverAmount).mockResolvedValue(0);
    const r = await applyBailoutResolution(db, {
      countryCode: "DE",
      currentTurn: 600,
      realtimeMs: 1_700_000_000_000,
      decisionId: new ObjectId(),
      executiveCharacterId: null,
    });
    expect(r.ok).toBe(true);
    expect(r.termsApplied?.principal).toBe(0);
  });
});
