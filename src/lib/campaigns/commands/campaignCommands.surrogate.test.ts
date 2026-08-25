import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { AuthUserWithCharacter } from "@/lib/auth";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

// Control the three campaign-actor predicates per test. legacyManagersAsList /
// MAX_CAMPAIGN_MANAGERS are provided so the module import binding resolves even
// though these tests never exercise the appoint path. vi.hoisted so the object
// exists before the hoisted vi.mock factory runs.
const access = vi.hoisted(() => ({
  isCampaignManagerUser: vi.fn().mockReturnValue(false),
  isCampaignNomineeUser: vi.fn().mockResolvedValue(false),
  isCampaignRunningMateUser: vi.fn().mockResolvedValue(false),
  legacyManagersAsList: vi.fn().mockReturnValue([]),
  MAX_CAMPAIGN_MANAGERS: 3,
}));
vi.mock("@/lib/campaigns/access", () => access);

// General-phase by default (primary ended at turn 1, race ends far out, clock at 100).
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

import { upgradeCampaign, fireRallyOneShot } from "./campaignCommands";

function makeUser(
  characterId: ObjectId,
  countryId = "US"
): AuthUserWithCharacter & {
  hasCharacter: true;
  character: { _id: ObjectId; countryId: string; name: string };
} {
  return {
    userId: new ObjectId().toString(),
    username: "tester",
    isAdmin: false,
    isBanned: false,
    hasCharacter: true,
    character: { _id: characterId, countryId, name: "VP" },
  } as unknown as AuthUserWithCharacter & {
    hasCharacter: true;
    character: { _id: ObjectId; countryId: string; name: string };
  };
}

function generalPresident(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionType: "president",
    status: "active",
    countryId: "US",
    primaryEndTurn: 1,
    endTurn: 999,
    ...overrides,
  };
}

describe("running-mate surrogate gating", () => {
  let db: MockDb;
  const campaignId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    access.isCampaignManagerUser.mockReturnValue(false);
    access.isCampaignNomineeUser.mockResolvedValue(false);
    access.isCampaignRunningMateUser.mockResolvedValue(false);
    db = createMockDb();
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId: new ObjectId(),
      candidateId: new ObjectId(),
      candidateIsNPP: false,
      party: "1",
      status: "active",
      funds: 1_000_000,
      actions: 100,
      fundraisingLevel: 0,
      activityHistory: [],
    });
    // Suspended-check lookup in getCampaignOrThrow: not suspended.
    db.collection("electionCandidates").findOne.mockResolvedValue(null);
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
  });

  it("rejects a running mate's fundraising upgrade during the primary phase", async () => {
    access.isCampaignRunningMateUser.mockResolvedValue(true);
    db.collection("elections").findOne.mockResolvedValue(
      // Primary NOT ended (turn 100 < 200) → not general phase.
      generalPresident({ primaryEndTurn: 200, endTurn: 400 })
    );

    await expect(
      upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeUser(new ObjectId()),
        category: "fundraising",
      })
    ).rejects.toThrow(/general election begins/i);
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a running mate on a non-presidential race", async () => {
    access.isCampaignRunningMateUser.mockResolvedValue(true);
    db.collection("elections").findOne.mockResolvedValue(
      generalPresident({ electionType: "senate" })
    );

    await expect(
      upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeUser(new ObjectId()),
        category: "fundraising",
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it("keeps non-fundraising upgrade lanes manager/nominee-only (running mate blocked)", async () => {
    access.isCampaignRunningMateUser.mockResolvedValue(true);
    db.collection("elections").findOne.mockResolvedValue(generalPresident());

    await expect(
      upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeUser(new ObjectId()),
        category: "mediaSpending",
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it("lets a manager act regardless of phase (surrogate assert is a superset)", async () => {
    access.isCampaignManagerUser.mockReturnValue(true);
    // Primary-phase senate race: a manager still passes the fundraising gate
    // (they fail later on max-level, not on authorization).
    db.collection("elections").findOne.mockResolvedValue(
      generalPresident({ electionType: "senate", primaryEndTurn: 200, endTurn: 400 })
    );

    await expect(
      upgradeCampaign({
        db: db as unknown as Db,
        campaignId,
        user: makeUser(new ObjectId()),
        category: "fundraising",
        branch: null,
      })
    ).resolves.toBeDefined();
  });
});

describe("rally is shared between running mate and nominee (augment not double)", () => {
  let db: MockDb;
  const campaignId = new ObjectId();
  const candidateId = new ObjectId();
  const candidateRowId = new ObjectId();

  function seedCampaign() {
    db.collection("campaigns").findOne.mockResolvedValue({
      _id: campaignId,
      electionId: new ObjectId(),
      candidateId,
      candidateIsNPP: false,
      party: "1",
      status: "active",
      funds: 1_000_000,
      actions: 100,
    });
    db.collection("elections").findOne.mockResolvedValue(generalPresident());
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    access.isCampaignManagerUser.mockReturnValue(false);
    access.isCampaignNomineeUser.mockResolvedValue(false);
    access.isCampaignRunningMateUser.mockResolvedValue(false);
    db = createMockDb();
  });

  it("a running mate can fire the ticket's rally", async () => {
    access.isCampaignRunningMateUser.mockResolvedValue(true);
    seedCampaign();
    // One candidate row backs both the suspended-check and the rally lookup.
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: candidateRowId,
      electionId: new ObjectId(),
      characterId: candidateId,
      status: "active",
      support: 50,
      campaignSuspended: false,
    });

    const result = await fireRallyOneShot({
      db: db as unknown as Db,
      campaignId,
      user: makeUser(new ObjectId()),
    });

    expect(result.nextSupport).toBeGreaterThan(50);
    // The throttle is written on the shared candidate row.
    const candUpdate = db.collectionMocks.electionCandidates.updateOne.mock.calls[0];
    expect((candUpdate[1] as { $set?: { lastRallyTurn?: number } }).$set?.lastRallyTurn).toBe(100);
  });

  it("blocks a same-turn rally once the shared lastRallyTurn is set", async () => {
    // The nominee fires after the running mate already did this turn: the same
    // candidate row now carries lastRallyTurn === currentTurn.
    access.isCampaignNomineeUser.mockResolvedValue(true);
    seedCampaign();
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: candidateRowId,
      electionId: new ObjectId(),
      characterId: candidateId,
      status: "active",
      support: 51,
      campaignSuspended: false,
      lastRallyTurn: 100,
    });

    await expect(
      fireRallyOneShot({
        db: db as unknown as Db,
        campaignId,
        user: makeUser(new ObjectId()),
      })
    ).rejects.toThrow(/already fired this turn/i);
    // No action debit on the blocked attempt.
    expect(db.collectionMocks.campaigns.updateOne).not.toHaveBeenCalled();
  });
});
