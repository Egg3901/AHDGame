import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  RULING_MULTIPLIER_LADDER,
  scheduleHonestByElection,
  setRulingPartyVoteMultiplierTier,
} from "@/lib/onePartyState/reformPrimitives";
import { DEFAULT_OPS_VOTE_MULTIPLIERS } from "@/lib/constants/countries";
import type { CountryState } from "@/lib/db/types/countryState";

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

describe("setRulingPartyVoteMultiplierTier", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
  });

  it("steps down from the default (3.0) to the next ladder rung (2.0)", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());

    const updated = await setRulingPartyVoteMultiplierTier(db as unknown as Db, "CN", "down");
    expect(updated.ruling).toBe(2.0);

    const writeCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const patchCall = writeCalls.find((c) => {
      const op = c[1] as { $set?: { opsVoteMultipliers?: { ruling: number } } };
      return op.$set?.opsVoteMultipliers?.ruling === 2.0;
    });
    expect(patchCall).toBeDefined();
  });

  it("steps from 2.0 → 1.5", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS, ruling: 2.0 } })
    );
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());

    const updated = await setRulingPartyVoteMultiplierTier(db as unknown as Db, "CN", "down");
    expect(updated.ruling).toBe(1.5);
  });

  it("steps from 1.5 → 1.0 (floor)", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS, ruling: 1.5 } })
    );
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());

    const updated = await setRulingPartyVoteMultiplierTier(db as unknown as Db, "CN", "down");
    expect(updated.ruling).toBe(1.0);
  });

  it("throws when already at the floor (1.0)", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(
      makeCountryState({ opsVoteMultipliers: { ...DEFAULT_OPS_VOTE_MULTIPLIERS, ruling: 1.0 } })
    );

    await expect(
      setRulingPartyVoteMultiplierTier(db as unknown as Db, "CN", "down")
    ).rejects.toThrow(/at floor/);
  });

  it("leaves approved/independent/banned multipliers untouched", async () => {
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());

    const updated = await setRulingPartyVoteMultiplierTier(db as unknown as Db, "CN", "down");
    expect(updated.approved).toBe(DEFAULT_OPS_VOTE_MULTIPLIERS.approved);
    expect(updated.independent).toBe(DEFAULT_OPS_VOTE_MULTIPLIERS.independent);
    expect(updated.banned).toBe(DEFAULT_OPS_VOTE_MULTIPLIERS.banned);
  });

  it("RULING_MULTIPLIER_LADDER is sorted descending and ends at 1.0", () => {
    for (let i = 1; i < RULING_MULTIPLIER_LADDER.length; i++) {
      expect(RULING_MULTIPLIER_LADDER[i]).toBeLessThan(RULING_MULTIPLIER_LADDER[i - 1]);
    }
    expect(RULING_MULTIPLIER_LADDER.at(-1)).toBe(1.0);
  });
});

describe("scheduleHonestByElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
    db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
    db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
  });

  it("writes the pendingHonestByElection flag with the supplied multiplier", async () => {
    await scheduleHonestByElection(db as unknown as Db, "CN", { atMultiplier: 1.0 });

    const writeCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
    const patchCall = writeCalls.find((c) => {
      const op = c[1] as { $set?: { pendingHonestByElection?: { atMultiplier: number } } };
      return op.$set?.pendingHonestByElection?.atMultiplier === 1.0;
    });
    expect(patchCall).toBeDefined();
  });
});
