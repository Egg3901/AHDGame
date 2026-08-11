import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/partyWhips/playerWhip", () => ({
  getEligibleCharactersForWhip: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/congress/applyPlayerWhip", () => ({
  applyPlayerWhipToBill: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToLeadership: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToGovernmentVote: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToCabinet: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
}));
vi.mock("@/lib/congress/applyWhipVotes", () => ({
  applyWhipVotesToBill: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToLeadership: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToGovernmentVote: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToCabinet: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
}));
vi.mock("@/lib/parties/antiAbuseGuards", () => ({
  getPartyNppControlStatus: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/whip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeAuthUser(chairId: ObjectId) {
  return {
    userId: new ObjectId().toString(),
    isAdmin: false,
    character: { _id: chairId },
  };
}

describe("POST /api/country/[code]/parties/[id]/whip", () => {
  let db: MockDb;
  let chairId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();

    for (const name of [
      "billWhips",
      "speakerElections",
      "senateLeadershipElections",
      "houseLeadershipElections",
      "characters",
      "noConfidenceVotes",
      "electedOfficials",
      "npps",
      "congressLeaders",
    ]) {
      db.collection(name);
    }

    db.collectionMocks["billWhips"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: makeAuthUser(chairId),
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);
  });

  it("accepts the live Speaker target id alias and stores the canonical current key", async () => {
    db.collectionMocks["speakerElections"]!.findOne.mockResolvedValue({
      _id: "current",
      status: "voting",
      endsAt: new Date("2026-04-27T00:00:00Z"),
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "speakerElection",
        targetId: "speaker",
        chamber: "house",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "speakerElection",
        targetId: "current",
        chamber: "house",
        audience: "character",
      })
    );

    const { applyPlayerWhipToLeadership } = await import("@/lib/congress/applyPlayerWhip");
    expect(applyPlayerWhipToLeadership).toHaveBeenCalledWith(
      db,
      expect.any(ObjectId),
      "speakerNominations",
      []
    );
  });

  it("validates U.S. Senate leadership whips against the senate leadership collection", async () => {
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "majority_leader",
      status: "voting",
      endsAt: new Date("2026-04-27T00:00:00Z"),
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "leadershipElection",
        targetId: "majority_leader",
        chamber: "senate",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "leadershipElection",
        targetId: "majority_leader",
        chamber: "senate",
        audience: "character",
      })
    );

    const { applyPlayerWhipToLeadership } = await import("@/lib/congress/applyPlayerWhip");
    expect(applyPlayerWhipToLeadership).toHaveBeenCalledWith(
      db,
      expect.any(ObjectId),
      "senateLeadershipNominations",
      []
    );
  });

  it("issues soft player whips as notifications without forcing votes", async () => {
    const billId = new ObjectId();
    const whippedCharacterId = new ObjectId();
    const whippedUserId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: whippedCharacterId,
          name: "Soft Whip Target",
          userId: whippedUserId,
          sequentialId: 101,
        },
      ])
    );

    const { getEligibleCharactersForWhip } = await import("@/lib/partyWhips/playerWhip");
    vi.mocked(getEligibleCharactersForWhip).mockResolvedValue([whippedCharacterId]);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        mode: "soft",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "house",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "character",
        mode: "soft",
        targetType: "bill",
      })
    );

    const { applyPlayerWhipToBill } = await import("@/lib/congress/applyPlayerWhip");
    const { sendSystemMail } = await import("@/lib/mail/systemMail");
    const { createNotification } = await import("@/lib/notifications");

    expect(applyPlayerWhipToBill).not.toHaveBeenCalled();
    expect(sendSystemMail).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Party vote recommendation",
        metadata: expect.objectContaining({ mode: "soft" }),
      })
    );
  });

  it("allows a hard player whip after a soft player whip already exists on the target", async () => {
    const billId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });
    db.collectionMocks["billWhips"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          targetType: "bill",
          targetId: billId,
          chamber: "house",
          partyId: "1",
          issuedBy: "nationalParty",
          audience: "character",
          mode: "soft",
          direction: "for",
          attemptNumber: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
    );

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        mode: "hard",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "house",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "character",
        mode: "hard",
        targetType: "bill",
      })
    );
  });

  it("rejects duplicate player whips of the same mode on the same target", async () => {
    const billId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });
    db.collectionMocks["billWhips"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          targetType: "bill",
          targetId: billId,
          chamber: "house",
          partyId: "1",
          issuedBy: "nationalParty",
          audience: "character",
          mode: "soft",
          direction: "for",
          attemptNumber: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
    );

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        mode: "soft",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "house",
        direction: "against",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "A Soft Player Whip has already been issued on this target",
    });
  });

  it("rejects leadershipElection whips on the Bundestag chamber for DE parties", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "DE",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "leadershipElection",
        targetId: new ObjectId().toString(),
        chamber: "bundestag",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "de", id: "1" }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("not supported for German chambers"),
    });
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects speakerElection whips on the Landtag chamber for DE parties", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "DE",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "speakerElection",
        targetId: new ObjectId().toString(),
        chamber: "landtag",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "de", id: "1" }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("not supported for German chambers"),
    });
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("allows a U.S. Senate Majority Leader to whip in the senate", async () => {
    const billId = new ObjectId();
    const leaderCharId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId: new ObjectId(),
      viceChairId: null,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: makeAuthUser(leaderCharId),
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue({
      role: "majority_leader_senate",
      characterId: leaderCharId,
      party: "1",
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "npp",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "senate",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "bill",
        targetId: billId,
        chamber: "senate",
        issuedByRole: "majorityLeader",
      })
    );
  });

  it("rejects a chamber leader whipping for the wrong chamber", async () => {
    const billId = new ObjectId();
    const leaderCharId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId: new ObjectId(),
      viceChairId: null,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: makeAuthUser(leaderCharId),
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      const q = query as { role?: { $in?: string[] } };
      if (q.role?.$in?.includes("majority_leader_senate")) {
        return { role: "majority_leader_senate", characterId: leaderCharId, party: "1" };
      }
      return null;
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "npp",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "house",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(403);
  });

  it("rejects a chamber leader whipping for the wrong party", async () => {
    const billId = new ObjectId();
    const leaderCharId = new ObjectId();

    db.collection("bills");
    db.collectionMocks["bills"]!.findOne.mockResolvedValue({
      _id: billId,
      title: "Test Bill",
      status: "active",
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId: new ObjectId(),
      viceChairId: null,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: makeAuthUser(leaderCharId),
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      const q = query as { role?: { $in?: string[] }; party?: string };
      if (q.role?.$in?.includes("majority_leader_senate") && q.party === "2") {
        return { role: "majority_leader_senate", characterId: leaderCharId, party: "2" };
      }
      return null;
    });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "npp",
        targetType: "bill",
        targetId: billId.toString(),
        chamber: "senate",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "us", id: "1" }),
      }
    );

    expect(response.status).toBe(403);
  });

  it("accepts Germany Bundestag no-confidence NPP whips", async () => {
    const voteId = new ObjectId();
    const nppId = new ObjectId();
    const official = {
      _id: new ObjectId(),
      countryId: "DE",
      officeType: "bundestag",
      characterId: null,
      isNPP: true,
      nppId,
      party: "1",
      seatsHeld: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "DE",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    db.collectionMocks["noConfidenceVotes"]!.findOne.mockResolvedValue({
      _id: voteId,
      countryId: "DE",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      closesAt: new Date(Date.now() + 60_000),
    });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([official]));
    db.collectionMocks["npps"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: nppId,
          countryId: "DE",
          homeState: "DE_BE",
          party: "1",
          personality: { loyalty: 100, ambition: 50, stubbornness: 0 },
        },
      ])
    );

    const { applyWhipVotesToGovernmentVote } = await import("@/lib/congress/applyWhipVotes");
    vi.mocked(applyWhipVotesToGovernmentVote).mockResolvedValue({ fellInLine: 1, ignored: 0 });

    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "npp",
        targetType: "noConfidenceVote",
        targetId: voteId.toString(),
        chamber: "bundestag",
        direction: "for",
      }),
      {
        params: Promise.resolve({ code: "de", id: "1" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "noConfidenceVote",
        targetId: voteId,
        chamber: "bundestag",
        countryId: "DE",
        audience: "npp",
      })
    );
    expect(applyWhipVotesToGovernmentVote).toHaveBeenCalledWith(
      db,
      voteId,
      "noConfidenceVote",
      "for",
      [official],
      expect.any(Map),
      "hard",
      expect.any(Number)
    );
  });
});
