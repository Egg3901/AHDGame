import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ApiError } from "@/lib/api/errors";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/campaigns/access", () => ({
  isCampaignManagerUser: vi.fn().mockReturnValue(false),
  isCampaignNomineeUser: vi.fn().mockResolvedValue(true),
}));

// upgradeCampaign reads game time via getGameTime for the general-phase cost
// multiplier; stub it (keep real hasGameTimePassed for the Date fallback).
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

import { donateToCampaign, upgradeCampaign } from "./campaignCommands";
import type { AuthUserWithCharacter } from "@/lib/auth";

function makeAuthUser(
  characterId: ObjectId,
  countryId: string
): AuthUserWithCharacter & {
  hasCharacter: true;
  character: { _id: ObjectId; countryId: string };
} {
  // Cast through unknown so we don't have to construct a fully-typed Character.
  return {
    userId: new ObjectId().toString(),
    username: "tester",
    isAdmin: false,
    isBanned: false,
    hasCharacter: true,
    character: { _id: characterId, countryId },
  } as unknown as AuthUserWithCharacter & {
    hasCharacter: true;
    character: { _id: ObjectId; countryId: string };
  };
}

describe("mutations reject archived campaigns", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("upgradeCampaign throws when the campaign is archived", async () => {
    const campaignId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId: new ObjectId(),
      party: "1",
      status: "archived",
      funds: 9_999_999,
      actions: 999,
      fundraisingLevel: 0,
    });

    await expect(
      upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeAuthUser(new ObjectId(), "US"),
        category: "fundraising",
      })
    ).rejects.toThrow(/no longer be managed/i);

    // Guard fires before any write.
    expect(db.collectionMocks.campaigns!.updateOne).not.toHaveBeenCalled();
  });
});

describe("donateToCampaign — same-country guard (character path)", () => {
  let db: MockDb;
  let campaignId: ObjectId;
  let characterId: ObjectId;
  let electionId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    campaignId = new ObjectId();
    characterId = new ObjectId();
    electionId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId,
      party: "1",
      funds: 0,
      donationLog: [],
    });
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 5 });
  });

  it("rejects when actor character country differs from the campaign's election country", async () => {
    db.collection("characters").findOne.mockResolvedValue({
      _id: characterId,
      countryId: "US",
      funds: 1_000_000,
      currencyBalances: { campaign: { USD: 1_000_000 } },
    });
    db.collection("elections").findOne.mockResolvedValue({
      _id: electionId,
      countryId: "UK",
    });

    let captured: unknown;
    try {
      await donateToCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeAuthUser(characterId, "US"),
        amount: 1000,
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).message).toMatch(/other countries/i);
    // Reject must happen before any debit/credit.
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("upgradeCampaign — same-country guard on opposition-research target", () => {
  let db: MockDb;
  let campaignId: ObjectId;
  let characterId: ObjectId;
  let foreignTargetId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    campaignId = new ObjectId();
    characterId = new ObjectId();
    foreignTargetId = new ObjectId();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId: new ObjectId(),
      party: "1",
      oppositionResearchLevel: 0,
      funds: 1_000_000,
      actions: 100,
      activityHistory: [],
    });
    db.collection("elections").findOne.mockResolvedValue(null);
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 5 });
  });

  it("rejects opposition-research upgrade against a target in another country", async () => {
    db.collection("characters").findOne.mockResolvedValue({
      _id: foreignTargetId,
      name: "UK Opponent",
      countryId: "UK",
    });

    let captured: unknown;
    try {
      await upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeAuthUser(characterId, "US"),
        category: "oppositionResearch",
        targetId: foreignTargetId.toString(),
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).message).toMatch(/other countries/i);
    expect(db.collectionMocks["campaigns"]!.updateOne).not.toHaveBeenCalled();
  });
});
