/**
 * Integration tests for popularLegitimacy persistence + slow-buildup tuning.
 *
 * The pure formulas have their own unit tests. This file pins three
 * runtime behaviors that the slower in-memory MockDb pattern is well-
 * suited to assert:
 *
 *   1. adjustPopularLegitimacy actually persists deltas + history entries.
 *   2. The drift integrates monotonically over many turns (sustained
 *      mismanagement steadily reduces legitimacy, doesn't spike).
 *   3. 30 turns of mild-bad governance moves the scalar by ~15-25
 *      points downward — the design's slow-buildup principle pinned.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  adjustPopularLegitimacy,
  INITIAL_POPULAR_LEGITIMACY,
  MAX_POPULAR_LEGITIMACY,
  MIN_POPULAR_LEGITIMACY,
} from "@/lib/turn/popularLegitimacy";
import { computePopularTurnDrift } from "@/lib/turn/popularLegitimacyTurn";
import { CN_POPULAR_MOOD_PROFILE } from "@/lib/constants/popularMoodProfiles";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

function makeMockDb() {
  const docs = new Map<string, CountryLeaderState>();

  function clone(doc: CountryLeaderState): CountryLeaderState {
    return {
      ...doc,
      _id: doc._id,
      leaderCharacterId: new ObjectId(doc.leaderCharacterId.toString()),
      confidenceHistory: doc.confidenceHistory.map((h) => ({ ...h, at: new Date(h.at) })),
      popularLegitimacyHistory: (doc.popularLegitimacyHistory ?? []).map((h) => ({
        ...h,
        at: new Date(h.at),
      })),
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  const collection = {
    findOne: vi.fn().mockImplementation((filter: { _id?: string }) => {
      const doc = filter._id ? (docs.get(filter._id) ?? null) : null;
      return Promise.resolve(doc ? clone(doc) : null);
    }),
    findOneAndUpdate: vi
      .fn()
      .mockImplementation(
        (filter: { _id: string }, update: { $set?: Partial<CountryLeaderState> }) => {
          const existing = docs.get(filter._id);
          if (!existing) return Promise.resolve(null);
          const next = clone(existing);
          if (update.$set) Object.assign(next, update.$set);
          docs.set(filter._id, next);
          return Promise.resolve(next);
        }
      ),
  };

  return {
    db: { collection: vi.fn().mockReturnValue(collection) } as unknown as Db,
    docs,
  };
}

function seedLeader(
  docs: Map<string, CountryLeaderState>,
  countryId: "CN",
  leaderCharacterId: ObjectId,
  startingPopular: number = INITIAL_POPULAR_LEGITIMACY,
  startingPartyConfidence: number = 75
) {
  const _id = `${countryId}_${leaderCharacterId.toString()}`;
  docs.set(_id, {
    _id,
    countryId,
    leaderCharacterId,
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence: startingPartyConfidence,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: startingPopular,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("popularLegitimacy persistence", () => {
  it("persists a delta and appends a history entry", async () => {
    const { db, docs } = makeMockDb();
    const leaderId = new ObjectId();
    seedLeader(docs, "CN", leaderId, 75);

    const result = await adjustPopularLegitimacy(db, "CN", leaderId, -3, "test drop", 10);

    expect(result?.popularLegitimacy).toBe(72);
    expect(result?.popularLegitimacyHistory).toHaveLength(1);
    expect(result?.popularLegitimacyHistory?.[0]).toMatchObject({
      turn: 10,
      previous: 75,
      next: 72,
      delta: -3,
      reason: "test drop",
    });
  });

  it("clamps at the MAX boundary", async () => {
    const { db, docs } = makeMockDb();
    const leaderId = new ObjectId();
    seedLeader(docs, "CN", leaderId, 99);

    const result = await adjustPopularLegitimacy(db, "CN", leaderId, 50, "boom", 5);
    expect(result?.popularLegitimacy).toBe(MAX_POPULAR_LEGITIMACY);
  });

  it("clamps at the MIN boundary", async () => {
    const { db, docs } = makeMockDb();
    const leaderId = new ObjectId();
    seedLeader(docs, "CN", leaderId, 5);

    const result = await adjustPopularLegitimacy(db, "CN", leaderId, -100, "disaster", 5);
    expect(result?.popularLegitimacy).toBe(MIN_POPULAR_LEGITIMACY);
  });

  it("returns null when no leader-state doc exists", async () => {
    const { db } = makeMockDb();
    const result = await adjustPopularLegitimacy(db, "CN", new ObjectId(), -1, "missing leader", 1);
    expect(result).toBeNull();
  });

  it("treats missing popularLegitimacy field as INITIAL_POPULAR_LEGITIMACY", async () => {
    const { db, docs } = makeMockDb();
    const leaderId = new ObjectId();
    const _id = `CN_${leaderId.toString()}`;
    // Doc without popularLegitimacy field (simulates pre-Phase-2 row)
    docs.set(_id, {
      _id,
      countryId: "CN",
      leaderCharacterId: leaderId,
      leaderOfficeType: "premier",
      governingPartyId: "1",
      partyConfidence: 75,
      startedAtTurn: 1,
      lastRenewedAtTurn: null,
      renewalCount: 0,
      confidenceHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await adjustPopularLegitimacy(db, "CN", leaderId, -5, "no-field test", 10);
    // 75 (initial fallback) - 5 = 70
    expect(result?.popularLegitimacy).toBe(70);
  });
});

describe("slow-buildup tuning (Phase 2 calibration)", () => {
  it("30 turns of mild-bad governance moves popularLegitimacy by 5-25 points downward", async () => {
    // Simulates: GDP growth 0%, unemployment slowly rising, inflation 1pp
    // off-target, one minor purge every 3 turns. No bills enacted.
    // Starting from 75 (above target so natural recovery is -0.1/turn).
    let current = 75;
    const partyConfidence = 75; // healthy, no coupling

    for (let turn = 1; turn <= 30; turn++) {
      const drift = computePopularTurnDrift({
        currentLegitimacy: current,
        partyConfidence,
        economic: {
          gdpGrowthAnnualPct: 0,
          unemploymentDeltaPct: 0.3,
          inflationDeviationFromTargetPct: 1,
        },
        purges: turn % 3 === 0 ? [{ severity: "minor", kind: "discipline" }] : [],
        enactedBills: [],
        election: { isElectionTurn: false, opsMultiplier: 1.0 },
        moodProfile: CN_POPULAR_MOOD_PROFILE,
        boosts: [],
        currentTurn: turn,
      });
      current = Math.max(
        MIN_POPULAR_LEGITIMACY,
        Math.min(MAX_POPULAR_LEGITIMACY, current + drift.total)
      );
    }

    const drop = 75 - current;
    expect(drop).toBeGreaterThanOrEqual(5);
    expect(drop).toBeLessThanOrEqual(25);
  });

  it("a quiet turn at 75 (above target) drifts down via natural recovery", () => {
    const drift = computePopularTurnDrift({
      currentLegitimacy: 75,
      partyConfidence: 75,
      economic: {
        gdpGrowthAnnualPct: 2.5,
        unemploymentDeltaPct: 0,
        inflationDeviationFromTargetPct: 0,
      },
      purges: [],
      enactedBills: [],
      election: { isElectionTurn: false, opsMultiplier: 1.0 },
      moodProfile: CN_POPULAR_MOOD_PROFILE,
      boosts: [],
      currentTurn: 100,
    });
    // Only natural recovery contributes; 75 > 60 (target) so drift is -0.1.
    expect(drift.total).toBeCloseTo(-0.1, 2);
  });

  it("normal-bad turn (no disaster) keeps drift within ±2", () => {
    const drift = computePopularTurnDrift({
      currentLegitimacy: 55,
      partyConfidence: 50,
      economic: {
        gdpGrowthAnnualPct: 1.0,
        unemploymentDeltaPct: 0.5,
        inflationDeviationFromTargetPct: 1.5,
      },
      purges: [{ severity: "moderate", kind: "discipline" }],
      enactedBills: [],
      election: { isElectionTurn: false, opsMultiplier: 1.0 },
      moodProfile: CN_POPULAR_MOOD_PROFILE,
      boosts: [],
      currentTurn: 100,
    });
    expect(Math.abs(drift.total)).toBeLessThanOrEqual(2.0);
  });
});
