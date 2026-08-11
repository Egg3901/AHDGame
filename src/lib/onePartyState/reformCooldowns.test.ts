import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { isActionAvailable, setCooldown } from "@/lib/onePartyState/reformCooldowns";
import type { CountryState, ReformCooldownsMap } from "@/lib/db/types/countryState";

function makeCountryState(overrides: Partial<CountryState> = {}): CountryState {
  return {
    _id: "CN",
    countryId: "CN",
    governmentType: "onePartyState",
    rulingPartyId: 1,
    opsVoteMultipliers: null,
    hasLeaderConfidenceModel: true,
    reformCooldowns: {},
    popularBoostModifiers: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("reformCooldowns helpers", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("countryState");
  });

  describe("isActionAvailable", () => {
    it("returns true when no cooldown set", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
      const available = await isActionAvailable(
        db as unknown as Db,
        "CN",
        "reduceVoteMultipliers",
        100
      );
      expect(available).toBe(true);
    });

    it("returns false when currentTurn < cooldownUntil", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(
        makeCountryState({ reformCooldowns: { reduceVoteMultipliers: 240 } })
      );
      const available = await isActionAvailable(
        db as unknown as Db,
        "CN",
        "reduceVoteMultipliers",
        100
      );
      expect(available).toBe(false);
    });

    it("returns true when currentTurn >= cooldownUntil", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(
        makeCountryState({ reformCooldowns: { reduceVoteMultipliers: 240 } })
      );
      const available = await isActionAvailable(
        db as unknown as Db,
        "CN",
        "reduceVoteMultipliers",
        240
      );
      expect(available).toBe(true);
    });

    it("constitutionalAmendment returns false once used", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(
        makeCountryState({ reformCooldowns: { constitutionalAmendment: "used" } })
      );
      const available = await isActionAvailable(
        db as unknown as Db,
        "CN",
        "constitutionalAmendment",
        500
      );
      expect(available).toBe(false);
    });

    it("legalizeParty cooldown is per-partyId, not global", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(
        makeCountryState({
          reformCooldowns: { legalizeParty: { perPartyId: { 5: 240 } } },
        })
      );
      // partyId 5 on cooldown at turn 100
      expect(
        await isActionAvailable(db as unknown as Db, "CN", "legalizeParty", 100, { partyId: 5 })
      ).toBe(false);
      // partyId 7 has no cooldown
      expect(
        await isActionAvailable(db as unknown as Db, "CN", "legalizeParty", 100, { partyId: 7 })
      ).toBe(true);
    });

    it("legalizeParty without partyId returns false (caller must scope)", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
      expect(await isActionAvailable(db as unknown as Db, "CN", "legalizeParty", 100)).toBe(false);
    });
  });

  describe("setCooldown", () => {
    beforeEach(() => {
      // updateCountryState reads then writes; both have to return real shapes.
      db.collectionMocks.countryState.findOne.mockResolvedValue(makeCountryState());
      db.collectionMocks.countryState.findOneAndUpdate.mockResolvedValue(makeCountryState());
    });

    it("writes turn-of-next-availability for the simple per-action key", async () => {
      await setCooldown(db as unknown as Db, "CN", "reduceVoteMultipliers", 100, 240);

      const updateCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
      const patchCall = updateCalls.find((c) => {
        const op = c[1] as { $set?: { reformCooldowns?: ReformCooldownsMap } };
        return op.$set?.reformCooldowns?.reduceVoteMultipliers === 340;
      });
      expect(patchCall).toBeDefined();
    });

    it("constitutionalAmendment marks as 'used' regardless of duration", async () => {
      await setCooldown(db as unknown as Db, "CN", "constitutionalAmendment", 500, 0);

      const updateCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
      const patchCall = updateCalls.find((c) => {
        const op = c[1] as { $set?: { reformCooldowns?: ReformCooldownsMap } };
        return op.$set?.reformCooldowns?.constitutionalAmendment === "used";
      });
      expect(patchCall).toBeDefined();
    });

    it("legalizeParty needs partyId — throws without it", async () => {
      await expect(
        setCooldown(db as unknown as Db, "CN", "legalizeParty", 100, 168)
      ).rejects.toThrow(/partyId/);
    });

    it("legalizeParty writes the partyId-keyed entry without disturbing other parties", async () => {
      db.collectionMocks.countryState.findOne.mockResolvedValue(
        makeCountryState({
          reformCooldowns: { legalizeParty: { perPartyId: { 3: 50 } } },
        })
      );

      await setCooldown(db as unknown as Db, "CN", "legalizeParty", 100, 168, { partyId: 7 });

      const updateCalls = db.collectionMocks.countryState.findOneAndUpdate.mock.calls;
      const patchCall = updateCalls.find((c) => {
        const op = c[1] as {
          $set?: { reformCooldowns?: ReformCooldownsMap };
        };
        return op.$set?.reformCooldowns?.legalizeParty !== undefined;
      });
      expect(patchCall).toBeDefined();
      const perParty = (
        patchCall![1] as {
          $set: { reformCooldowns: ReformCooldownsMap };
        }
      ).$set.reformCooldowns.legalizeParty!.perPartyId;
      // Existing entry for party 3 preserved + new entry for 7 added.
      expect(perParty[3]).toBe(50);
      expect(perParty[7]).toBe(268);
    });
  });
});
