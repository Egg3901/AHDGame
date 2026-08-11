import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { computeNpcSupportScore, runNpcLegislatorAutoVote } from "../npcLegislatorAutoVote";
import type { SovereignCrisisDecision } from "@/lib/db/types/sovereignCrisisDecision";

describe("computeNpcSupportScore", () => {
  it("free-market NPP supports bailout", () => {
    const score = computeNpcSupportScore(
      {
        policies: { economic: 60, social: 0 },
        personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      },
      "bailout"
    );
    expect(score).toBeGreaterThan(0.6);
  });
  it("populist NPP supports repudiate", () => {
    const score = computeNpcSupportScore(
      {
        policies: { economic: -60, social: 30 },
        personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      },
      "repudiate"
    );
    expect(score).toBeGreaterThan(0.6);
  });
  it("technocrat opposes repudiate", () => {
    const score = computeNpcSupportScore(
      {
        policies: { economic: 50, social: 0 },
        personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      },
      "repudiate"
    );
    expect(score).toBeLessThan(0.5);
  });
  it("loyal NPP biases mildly toward for", () => {
    const high = computeNpcSupportScore(
      {
        policies: { economic: 0, social: 0 },
        personality: { loyalty: 90, ambition: 50, stubbornness: 50 },
      },
      "bailout"
    );
    const low = computeNpcSupportScore(
      {
        policies: { economic: 0, social: 0 },
        personality: { loyalty: 10, ambition: 50, stubbornness: 50 },
      },
      "bailout"
    );
    expect(high).toBeGreaterThan(low);
  });
});

describe("runNpcLegislatorAutoVote", () => {
  function makeDb(opts: { npps: Array<Record<string, unknown>>; voteUpdateModified?: number }) {
    const updates: Array<{
      filter: Record<string, unknown>;
      $set: Record<string, unknown>;
      $inc: Record<string, unknown>;
    }> = [];
    return {
      updates,
      db: {
        collection: vi.fn((name: string) => {
          if (name === "npps") {
            return {
              find: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue(opts.npps),
              }),
            };
          }
          if (name === "sovereignCrisisDecisions") {
            return {
              updateOne: vi.fn(
                async (filter: Record<string, unknown>, u: Record<string, unknown>) => {
                  updates.push({
                    filter,
                    $set: u.$set as Record<string, unknown>,
                    $inc: u.$inc as Record<string, unknown>,
                  });
                  return {
                    acknowledged: true,
                    modifiedCount: opts.voteUpdateModified ?? 1,
                  };
                }
              ),
            };
          }
          throw new Error(`unexpected: ${name}`);
        }),
      } as never,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDecision(extra: Partial<SovereignCrisisDecision> = {}): SovereignCrisisDecision {
    return {
      _id: new ObjectId(),
      countryCode: "US",
      state: "executiveProposed",
      firedAtTurn: 100,
      firedAtRealtimeMs: Date.now(),
      executiveChoice: "bailout",
      executiveProposedAtRealtimeMs: Date.now(),
      requiresLegislativeRatification: true,
      legislativeBillId: null,
      resolvedAt: null,
      resolvedReason: null,
      legislativePhases: [
        {
          chamberKey: "house",
          startedAtRealtimeMs: Date.now(),
          endsAtRealtimeMs: Date.now() + 24 * 3_600_000,
          votesFor: 0,
          votesAgainst: 0,
          votes: {},
          outcome: "pending",
        },
      ],
      currentChamberIndex: 0,
      createdAt: new Date(),
      ...extra,
    };
  }

  it("skips when phase is not pending", async () => {
    const decision = makeDecision({
      legislativePhases: [
        {
          chamberKey: "house",
          startedAtRealtimeMs: Date.now(),
          endsAtRealtimeMs: Date.now(),
          votesFor: 5,
          votesAgainst: 5,
          votes: {},
          outcome: "passed",
        },
      ],
    });
    const { db, updates } = makeDb({ npps: [{ _id: new ObjectId() }] });
    const r = await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("skips already-voted NPPs (idempotency by votes map)", async () => {
    const nppId = new ObjectId();
    const decision = makeDecision();
    decision.legislativePhases![0].votes = { [nppId.toString()]: "for" };
    const { db, updates } = makeDb({
      npps: [
        {
          _id: nppId,
          policies: { economic: 60, social: 0 },
          personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
        },
      ],
    });
    const r = await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("votes new NPPs and counts them", async () => {
    const decision = makeDecision();
    const { db, updates } = makeDb({
      npps: [
        {
          _id: new ObjectId(),
          policies: { economic: 60, social: 0 },
          personality: { loyalty: 80, ambition: 50, stubbornness: 50 },
        },
        {
          _id: new ObjectId(),
          policies: { economic: -60, social: 30 },
          personality: { loyalty: 30, ambition: 50, stubbornness: 50 },
        },
      ],
    });
    const r = await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(2);
    expect(updates).toHaveLength(2);
    // Free-market NPP voted "for" bailout
    const firstVote = updates[0].$set;
    const firstFieldKey = Object.keys(firstVote)[0];
    expect(firstVote[firstFieldKey]).toBe("for");
  });

  it("skipped vote (race) does not increment counters", async () => {
    const decision = makeDecision();
    const { db } = makeDb({
      npps: [
        {
          _id: new ObjectId(),
          policies: { economic: 60, social: 0 },
          personality: { loyalty: 80, ambition: 50, stubbornness: 50 },
        },
      ],
      voteUpdateModified: 0, // race-loser
    });
    const r = await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(0);
  });

  it("returns empty when no executiveChoice", async () => {
    const decision = makeDecision({ executiveChoice: null });
    const { db } = makeDb({ npps: [] });
    const r = await runNpcLegislatorAutoVote(db, {
      decision,
      chamberIndex: 0,
      countryCode: "US",
    });
    expect(r.npcsVoted).toBe(0);
  });
});
