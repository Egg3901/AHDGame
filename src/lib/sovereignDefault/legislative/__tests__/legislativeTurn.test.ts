import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/sovereignDefault/resolution/repudiate", () => ({
  applyRepudiateResolution: vi.fn().mockResolvedValue({ ok: true, bondsAffected: 3 }),
}));
vi.mock("@/lib/sovereignDefault/resolution/restructure", () => ({
  applyRestructureResolution: vi.fn().mockResolvedValue({ ok: true, bondsAffected: 3 }),
}));
vi.mock("@/lib/sovereignDefault/resolution/bailout", () => ({
  applyBailoutResolution: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/sovereignDefault/resolution/monetize", () => ({
  applyMonetizeResolution: vi
    .fn()
    .mockResolvedValue({ ok: true, printedAmount: 0, inflationShockPp: 0 }),
}));
// Phase 10: NPC auto-vote runs as a turn-pre-pass. Default to a no-op mock
// so existing tests don't need to stub the npps collection lookup; the
// dedicated npc/__tests__/npcLegislatorAutoVote.test.ts covers the function.
vi.mock("@/lib/sovereignDefault/npc/npcLegislatorAutoVote", () => ({
  runNpcLegislatorAutoVote: vi
    .fn()
    .mockResolvedValue({ npcsVoted: 0, votesFor: 0, votesAgainst: 0 }),
}));
// Phase 11b: legislator favorability impacts are best-effort (try/catch in the
// orchestrator) and exercised by their own unit tests. Mock at the module
// boundary so this test's mock db doesn't have to handle the npps/characters
// projections inside applyLegislatorImpactsForChamber.
vi.mock("../applyLegislatorImpactsForChamber", () => ({
  applyLegislatorImpactsForChamber: vi
    .fn()
    .mockResolvedValue({ npcsAffected: 0, charactersAffected: 0 }),
}));

import { processSovereignLegislativeTurn } from "../legislativeTurn";
import { applyBailoutResolution } from "@/lib/sovereignDefault/resolution/bailout";
import { applyMonetizeResolution } from "@/lib/sovereignDefault/resolution/monetize";
import { applyRepudiateResolution } from "@/lib/sovereignDefault/resolution/repudiate";

interface FakeDecision {
  _id: ObjectId;
  state: string;
  countryCode: string;
  executiveChoice?: string | null;
  currentChamberIndex?: number | null;
  legislativePhases?: Array<{
    chamberKey: string;
    startedAtRealtimeMs: number;
    endsAtRealtimeMs: number;
    votesFor: number;
    votesAgainst: number;
    votes: Record<string, "for" | "against">;
    outcome: "pending" | "passed" | "rejected";
  }>;
}

function makeDb(rows: FakeDecision[]) {
  let active = [...rows];
  const sets: Array<{ id: ObjectId; $set: Record<string, unknown> }> = [];
  const db = {
    collection: vi.fn(() => ({
      find: vi.fn().mockReturnValue({
        toArray: vi
          .fn()
          .mockImplementation(async () => active.filter((r) => r.state === "executiveProposed")),
      }),
      // Phase 10 added a re-fetch before tally so NPC votes that just landed
      // are visible. Mirror updateOne's in-memory state so the tally sees the
      // latest row.
      findOne: vi.fn(async (filter: { _id: ObjectId }) => {
        return active.find((r) => r._id.equals(filter._id)) ?? null;
      }),
      updateOne: vi.fn(async (filter: { _id: ObjectId }, u: Record<string, unknown>) => {
        sets.push({ id: filter._id, $set: u.$set as Record<string, unknown> });
        const $set = u.$set as object;
        active = active.map((r) =>
          r._id.equals(filter._id) ? ({ ...r, ...$set } as FakeDecision) : r
        );
        return { acknowledged: true, modifiedCount: 1 };
      }),
    })),
  } as unknown as Db;
  return { db, sets };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processSovereignLegislativeTurn", () => {
  it("does nothing when no executiveProposed decisions", async () => {
    const { db } = makeDb([]);
    const r = await processSovereignLegislativeTurn(db, Date.now(), 100);
    expect(r.decisionsEvaluated).toBe(0);
  });

  it("does nothing when phase deadline has not yet passed", async () => {
    const id = new ObjectId();
    const { db, sets } = makeDb([
      {
        _id: id,
        state: "executiveProposed",
        countryCode: "US",
        executiveChoice: "bailout",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 60_000,
            votesFor: 30,
            votesAgainst: 10,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    const r = await processSovereignLegislativeTurn(db, Date.now(), 100);
    expect(r.decisionsEvaluated).toBe(1);
    expect(sets).toHaveLength(0);
  });

  it("rejects → calls applyRepudiateResolution + sets decision to rejected", async () => {
    const id = new ObjectId();
    const past = Date.now() - 10_000;
    const { db, sets } = makeDb([
      {
        _id: id,
        state: "executiveProposed",
        countryCode: "US",
        executiveChoice: "bailout",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: past - 24 * 3_600_000,
            endsAtRealtimeMs: past,
            votesFor: 10,
            votesAgainst: 30,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    await processSovereignLegislativeTurn(db, Date.now(), 100);
    expect(applyRepudiateResolution).toHaveBeenCalledTimes(1);
    expect(sets[0].$set.state).toBe("rejected");
    // Regression: orchestrator must be invoked with skipDecisionUpdate=true so
    // its own $set doesn't overwrite the rejection state to "ratified".
    expect(vi.mocked(applyRepudiateResolution).mock.calls[0][1]).toMatchObject({
      skipDecisionUpdate: true,
    });
  });

  it("passes lower-chamber → opens upper-chamber phase", async () => {
    const id = new ObjectId();
    const past = Date.now() - 10_000;
    const { db, sets } = makeDb([
      {
        _id: id,
        state: "executiveProposed",
        countryCode: "US",
        executiveChoice: "bailout",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: past - 24 * 3_600_000,
            endsAtRealtimeMs: past,
            votesFor: 30,
            votesAgainst: 10,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    await processSovereignLegislativeTurn(db, Date.now(), 100);
    const $set = sets[0].$set;
    expect($set.currentChamberIndex).toBe(1);
    const phases = $set.legislativePhases as Array<{ chamberKey: string; outcome: string }>;
    expect(phases).toHaveLength(2);
    expect(phases[0].outcome).toBe("passed");
    expect(phases[1].chamberKey).toBe("senate");
    expect(applyBailoutResolution).not.toHaveBeenCalled();
  });

  it("ratified monetize blocked by inflation gate → falls back to Repudiate", async () => {
    // Regression: if inflation rises past 8% during the ratification window,
    // applyMonetizeResolution returns ok=false reason="monetize-gated-by-inflation".
    // The country must NOT be left stuck in "crisisResolving" — the legislative
    // turn auto-falls-back to Repudiate so the state machine moves forward.
    vi.mocked(applyMonetizeResolution).mockResolvedValueOnce({
      ok: false,
      reason: "monetize-gated-by-inflation",
    });
    const id = new ObjectId();
    const past = Date.now() - 10_000;
    const { db, sets } = makeDb([
      {
        _id: id,
        state: "executiveProposed",
        countryCode: "US",
        executiveChoice: "monetize",
        currentChamberIndex: 1,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: past - 48 * 3_600_000,
            endsAtRealtimeMs: past - 24 * 3_600_000,
            votesFor: 30,
            votesAgainst: 10,
            votes: {},
            outcome: "passed",
          },
          {
            chamberKey: "senate",
            startedAtRealtimeMs: past - 24 * 3_600_000,
            endsAtRealtimeMs: past,
            votesFor: 60,
            votesAgainst: 40,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    await processSovereignLegislativeTurn(db, Date.now(), 100);
    expect(applyMonetizeResolution).toHaveBeenCalledTimes(1);
    expect(applyRepudiateResolution).toHaveBeenCalledTimes(1);
    // Decision row still ends ratified (the legislative branch resolved) but
    // the resolvedReason records the fallback so the audit trail is preserved.
    expect(sets[0].$set.state).toBe("ratified");
    expect(String(sets[0].$set.resolvedReason)).toContain("fell back to Repudiate");
  });

  it("preserves NPC votes added between read and tally write", async () => {
    // Regression: when runNpcLegislatorAutoVote writes votes via dotted-key
    // updates, the in-memory `phases` from the initial read becomes stale.
    // Subsequent `legislativePhases: updatedPhases` writes must use the
    // re-fetched (live) phases so they don't wipe the NPC votes map.
    const id = new ObjectId();
    const past = Date.now() - 10_000;
    const initialPhase = {
      chamberKey: "house",
      startedAtRealtimeMs: past - 24 * 3_600_000,
      endsAtRealtimeMs: past,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      outcome: "pending" as const,
    };
    const decision: FakeDecision = {
      _id: id,
      state: "executiveProposed",
      countryCode: "US",
      executiveChoice: "bailout",
      currentChamberIndex: 0,
      legislativePhases: [initialPhase],
    };
    // Simulate NPC auto-vote landing between read and tally: when findOne
    // is called, return a row with the phase enriched with NPC votes.
    const enrichedPhase = {
      ...initialPhase,
      votesFor: 30,
      votes: { someNppId: "for" as const },
    };
    const sets: Array<{ $set: Record<string, unknown> }> = [];
    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([decision]),
        }),
        findOne: vi.fn().mockResolvedValue({
          ...decision,
          legislativePhases: [enrichedPhase],
        }),
        updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
          sets.push({ $set: u.$set as Record<string, unknown> });
          return { acknowledged: true, modifiedCount: 1 };
        }),
      })),
    } as unknown as Db;
    await processSovereignLegislativeTurn(db, Date.now(), 100);
    // The first $set is the legislativeTurn's own decision row update.
    // It must include the ENRICHED phase (with NPC votes), not the stale empty one.
    const writtenPhases = sets[0].$set.legislativePhases as Array<{
      votes: Record<string, unknown>;
      votesFor: number;
    }>;
    expect(writtenPhases[0].votesFor).toBe(30);
    expect(writtenPhases[0].votes.someNppId).toBe("for");
  });

  it("passes upper-chamber → ratified and orchestrator runs", async () => {
    const id = new ObjectId();
    const past = Date.now() - 10_000;
    const { db, sets } = makeDb([
      {
        _id: id,
        state: "executiveProposed",
        countryCode: "US",
        executiveChoice: "bailout",
        currentChamberIndex: 1,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: past - 48 * 3_600_000,
            endsAtRealtimeMs: past - 24 * 3_600_000,
            votesFor: 30,
            votesAgainst: 10,
            votes: {},
            outcome: "passed",
          },
          {
            chamberKey: "senate",
            startedAtRealtimeMs: past - 24 * 3_600_000,
            endsAtRealtimeMs: past,
            votesFor: 60,
            votesAgainst: 40,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    await processSovereignLegislativeTurn(db, Date.now(), 100);
    expect(applyBailoutResolution).toHaveBeenCalledTimes(1);
    expect(sets[0].$set.state).toBe("ratified");
    // Regression: orchestrator must be invoked with skipDecisionUpdate=true so
    // its own $set doesn't clobber `executiveProposedAtRealtimeMs` (which is
    // the time the executive proposed, not the time of ratification).
    expect(vi.mocked(applyBailoutResolution).mock.calls[0][1]).toMatchObject({
      skipDecisionUpdate: true,
    });
  });
});
