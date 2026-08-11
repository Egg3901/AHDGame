import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/campaigns/access", () => ({
  isCampaignManagerUser: vi.fn().mockReturnValue(false),
  isCampaignNomineeUser: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 5,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

import { contributeCampaignStrength } from "./campaignCommands";
import type { AuthUserWithCharacter } from "@/lib/auth";
import type { Character } from "@/lib/db/types";

function makeAuthUser(
  characterId: ObjectId,
  countryId: string,
  nationalInfluence: number
): AuthUserWithCharacter & { hasCharacter: true; character: Character } {
  return {
    userId: new ObjectId().toString(),
    username: "tester",
    isAdmin: false,
    isBanned: false,
    hasCharacter: true,
    character: { _id: characterId, countryId, nationalInfluence },
  } as unknown as AuthUserWithCharacter & { hasCharacter: true; character: Character };
}

/**
 * UI-honesty gate (#2891 bundle): only the presidential engine consumes
 * `campaignStrength`, so contributions to down-ballot races must be rejected
 * server-side BEFORE any funds/actions debit.
 */
describe("contributeCampaignStrength — presidential-only gate", () => {
  let db: MockDb;
  let campaignId: ObjectId;
  let electionId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    campaignId = new ObjectId();
    electionId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId,
      party: "1",
      status: "active",
      campaignStrength: 100,
    });
  });

  it.each(["senate", "governor", "house", "stateSenate"] as const)(
    "rejects %s races before charging the character",
    async (electionType) => {
      db.collection("elections").findOne.mockResolvedValue({
        _id: electionId,
        electionType,
        countryId: "US",
        status: "active",
      });

      await expect(
        contributeCampaignStrength({
          db: db as unknown as Db,
          campaignId,
          user: makeAuthUser(new ObjectId(), "US", 50),
        })
      ).rejects.toThrow(/only affects presidential races/i);

      // Refund-safe: no character debit and no campaign credit happened.
      expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
      expect(db.collection("campaigns").updateOne).not.toHaveBeenCalled();
    }
  );

  it("lets presidential races past the gate (fails later on NPI, not the race type)", async () => {
    db.collection("elections").findOne.mockResolvedValue({
      _id: electionId,
      electionType: "president",
      countryId: "US",
      status: "active",
    });

    // Zero NPI trips the next guard, proving the presidential gate passed.
    await expect(
      contributeCampaignStrength({
        db: db as unknown as Db,
        campaignId,
        user: makeAuthUser(new ObjectId(), "US", 0),
      })
    ).rejects.toThrow(/no national influence/i);
  });
});
