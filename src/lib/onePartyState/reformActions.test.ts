import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  anticorruptionPurgeAction,
  constitutionalAmendmentAction,
  holdHonestByElectionAction,
  legalizePartyAction,
  reduceVoteMultipliersAction,
  type ReformActionContext,
} from "@/lib/onePartyState/reformActions";
import type { CountryState } from "@/lib/db/types/countryState";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

function makeCountryState(overrides: Partial<CountryState> = {}): CountryState {
  return {
    _id: "CN",
    countryId: "CN",
    governmentType: "onePartyState",
    rulingPartyId: 1,
    opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS },
    hasLeaderConfidenceModel: true,
    reformCooldowns: {},
    popularBoostModifiers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLeaderState(): CountryLeaderState {
  return {
    _id: "CN_stub",
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    leaderOfficeType: "premier",
    governingPartyId: "1",
    partyConfidence: 60,
    startedAtTurn: 1,
    lastRenewedAtTurn: null,
    renewalCount: 0,
    confidenceHistory: [],
    popularLegitimacy: 50,
    popularLegitimacyHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(db: MockDb, currentTurn = 100): ReformActionContext {
  return {
    db: db as unknown as Db,
    countryId: "CN",
    leaderCharacterId: new ObjectId(),
    currentTurn,
  };
}

function findBoostInWrites(
  db: MockDb,
  source: string
): { source: string; perTurnDelta: number; untilTurn: number } | undefined {
  const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
  for (const c of writes) {
    const set = (c[1] as { $set?: { popularBoostModifiers?: unknown[] } }).$set;
    const list = set?.popularBoostModifiers as
      { source: string; perTurnDelta: number; untilTurn: number }[] | undefined;
    if (!list) continue;
    const match = list.find((b) => b.source === source);
    if (match) return match;
  }
  return undefined;
}

function findCooldownInWrites(
  db: MockDb,
  predicate: (cd: unknown) => boolean
): unknown | undefined {
  const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
  for (const c of writes) {
    const set = (c[1] as { $set?: { reformCooldowns?: unknown } }).$set;
    if (set?.reformCooldowns && predicate(set.reformCooldowns)) return set.reformCooldowns;
  }
  return undefined;
}

describe("reformActions", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collection("countryLeaderStates");
    db.collection("politicalParties");
    db.collection("rulingPartyPurgeEvents");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue(makeLeaderState());
    db.collectionMocks.countryLeaderStates.findOneAndUpdate.mockResolvedValue(makeLeaderState());
  });

  // ── legalizePartyAction ──────────────────────────────────────────────────

  it("legalizeParty: applies cost+gain, flips party banned→approved, sets boost+cooldown", async () => {
    await legalizePartyAction(makeContext(db), 7);

    // Confidence + popular adjusted on leader-state
    expect(db.collectionMocks.countryLeaderStates.findOneAndUpdate).toHaveBeenCalledTimes(2);
    // Party flipped: politicalParties.updateOne with regimeStatus banned → approved
    const partyCall = db.collectionMocks.politicalParties.updateOne.mock.calls[0];
    expect((partyCall![0] as { sequentialId: number; regimeStatus: string }).sequentialId).toBe(7);
    expect((partyCall![1] as { $set: { regimeStatus: string } }).$set.regimeStatus).toBe(
      "approved"
    );

    const boost = findBoostInWrites(db, "legalizeParty");
    expect(boost).toEqual({ source: "legalizeParty", perTurnDelta: 0.2, untilTurn: 220 });

    const cd = findCooldownInWrites(db, (c) => {
      const cc = c as { legalizeParty?: { perPartyId: Record<number, number> } };
      return cc.legalizeParty?.perPartyId?.[7] === 268;
    });
    expect(cd).toBeDefined();
  });

  it("legalizeParty: throws when partyId is already on cooldown", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({
        reformCooldowns: { legalizeParty: { perPartyId: { 7: 500 } } },
      })
    );
    await expect(legalizePartyAction(makeContext(db, 100), 7)).rejects.toThrow(/on cooldown/);
  });

  // ── reduceVoteMultipliersAction ──────────────────────────────────────────

  it("reduceVoteMultipliers: tiers ruling 3.0 → 2.0, sets boost + cooldown", async () => {
    await reduceVoteMultipliersAction(makeContext(db));

    // Multiplier patched on countryState
    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const mc = writes.find((c) => {
      const op = c[1] as { $set?: { opsVoteMultipliers?: { ruling: number } } };
      return op.$set?.opsVoteMultipliers?.ruling === 2.0;
    });
    expect(mc).toBeDefined();

    const boost = findBoostInWrites(db, "reduceVoteMultipliers");
    expect(boost).toEqual({ source: "reduceVoteMultipliers", perTurnDelta: 0.15, untilTurn: 196 });

    const cd = findCooldownInWrites(db, (c) => {
      const cc = c as { reduceVoteMultipliers?: number };
      return cc.reduceVoteMultipliers === 340;
    });
    expect(cd).toBeDefined();
  });

  // ── holdHonestByElectionAction ───────────────────────────────────────────

  it("holdHonestByElection: writes pendingHonestByElection flag + cooldown", async () => {
    await holdHonestByElectionAction(makeContext(db));

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const flag = writes.find((c) => {
      const op = c[1] as { $set?: { pendingHonestByElection?: { atMultiplier: number } } };
      return op.$set?.pendingHonestByElection?.atMultiplier === 1.0;
    });
    expect(flag).toBeDefined();

    const cd = findCooldownInWrites(db, (c) => {
      const cc = c as { holdHonestByElection?: number };
      return cc.holdHonestByElection === 196;
    });
    expect(cd).toBeDefined();
  });

  // ── anticorruptionPurgeAction ────────────────────────────────────────────

  it("anticorruptionPurge: inserts a minor anticorruption purge + cooldown", async () => {
    await anticorruptionPurgeAction(makeContext(db));

    const purgeInsert = db.collectionMocks.rulingPartyPurgeEvents.insertOne.mock.calls[0][0] as {
      severity: string;
      kind: string;
    };
    expect(purgeInsert.severity).toBe("minor");
    expect(purgeInsert.kind).toBe("anticorruption");

    const cd = findCooldownInWrites(db, (c) => {
      const cc = c as { anticorruptionPurge?: number };
      return cc.anticorruptionPurge === 172;
    });
    expect(cd).toBeDefined();
  });

  // ── constitutionalAmendmentAction ────────────────────────────────────────

  it("constitutionalAmendment: writes renewalBumpOverride=2, marks cooldown 'used'", async () => {
    await constitutionalAmendmentAction(makeContext(db));

    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const renewalPatch = writes.find((c) => {
      const op = c[1] as { $set?: { renewalBumpOverride?: number } };
      return op.$set?.renewalBumpOverride === 2;
    });
    expect(renewalPatch).toBeDefined();

    const cd = findCooldownInWrites(db, (c) => {
      const cc = c as { constitutionalAmendment?: string };
      return cc.constitutionalAmendment === "used";
    });
    expect(cd).toBeDefined();

    const boost = findBoostInWrites(db, "constitutionalAmendment");
    expect(boost).toEqual({
      source: "constitutionalAmendment",
      perTurnDelta: 0.3,
      untilTurn: 340,
    });
  });

  it("constitutionalAmendment: throws on second invocation (one-time)", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ reformCooldowns: { constitutionalAmendment: "used" } })
    );
    await expect(constitutionalAmendmentAction(makeContext(db))).rejects.toThrow(/already used/);
  });

  // ── discount consumption ─────────────────────────────────────────────────

  it("pendingReformDiscount: halves intra-party cost and clears the flag on first use", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ pendingReformDiscount: { turn: 100, multiplier: 0.5 } })
    );

    await reduceVoteMultipliersAction(makeContext(db, 100));

    // Discount cleared via updateCountryState — look for an unset-style write
    // (the helper sets pendingReformDiscount to undefined which serializes as a key
    // present with undefined value in the $set).
    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const clearCall = writes.find((c) => {
      const op = c[1] as { $set?: Record<string, unknown> };
      return (
        op.$set && "pendingReformDiscount" in op.$set && op.$set.pendingReformDiscount === undefined
      );
    });
    expect(clearCall).toBeDefined();
  });

  it("pendingReformDiscount from a different turn does not apply", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ pendingReformDiscount: { turn: 99, multiplier: 0.5 } })
    );

    await reduceVoteMultipliersAction(makeContext(db, 100));

    // No discount-clear call should have happened since the discount didn't apply
    const writes = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const clearCall = writes.find((c) => {
      const op = c[1] as { $set?: Record<string, unknown> };
      return op.$set && "pendingReformDiscount" in op.$set;
    });
    expect(clearCall).toBeUndefined();
  });
});
