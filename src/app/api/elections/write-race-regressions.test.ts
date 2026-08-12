import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
  requireHumanSessionWithCharacter: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  ELECTION_LIMITS: { maxRequests: 20, windowMs: 60_000 },
}));

vi.mock("@/lib/api/requestLog", () => ({
  logRequest: vi.fn(),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-04-29T15:00:00Z"),
    isActive: true,
    pausedAt: null,
    effectiveNow: new Date("2026-04-29T16:00:00Z"),
  }),
}));

vi.mock("@/lib/achievements/triggers", () => ({
  checkElectionEntryAchievements: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/campaigns/createInitialCampaign", () => ({
  createInitialCampaign: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/campaigns/isCampaignEligible", () => ({
  isCampaignEligibleElection: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));

vi.mock("@/lib/elections/activeCandidacy", () => ({
  findBlockingActiveCandidacy: vi.fn(),
}));

vi.mock("@/lib/elections/executiveTermLimits", () => ({
  hasReachedExecutiveTermLimit: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/auth/newCharacterCooldown", () => ({
  isInNewCharacterCooldown: vi.fn().mockReturnValue({ blocked: false }),
}));

vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
}));

vi.mock("@/lib/utils/statePartyElectionValidation", () => ({
  validateStatePartyElectionAccess: vi.fn(),
}));

vi.mock("@/lib/nationalPartyElections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nationalPartyElections")>(
    "@/lib/nationalPartyElections"
  );
  return {
    ...actual,
    notifyNationalCandidacyDeclared: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/nationalCommitteeElections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nationalCommitteeElections")>(
    "@/lib/nationalCommitteeElections"
  );
  return {
    ...actual,
    notifyCommitteeCandidacyDeclared: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/statePartyElections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/statePartyElections")>(
    "@/lib/statePartyElections"
  );
  return {
    ...actual,
    notifyCandidacyDeclared: vi.fn().mockResolvedValue(undefined),
  };
});

function duplicateKeyError(message: string, keyPattern: Record<string, number>) {
  return Object.assign(new Error(message), { code: 11000, keyPattern });
}

function mockDbWithCollections(collections: Record<string, unknown>) {
  return {
    collection: vi.fn((name: string) => collections[name] ?? {}),
  };
}

function emptyFindCursor() {
  const cursor = {
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn(),
    limit: vi.fn(),
    next: vi.fn().mockResolvedValue(null),
  };
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return cursor;
}

describe("Election write race regressions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const { requireAuthWithCharacter, requireHumanSessionWithCharacter } =
      await import("@/lib/api/requireAuth");
    const authResult = {
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "tester",
        email: "tester@example.com",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId("507f1f77bcf86cd799439021"),
          userId: new ObjectId("507f1f77bcf86cd799439011"),
          name: "Test Character",
          party: "1",
          homeState: "US-CA",
          countryId: "US",
          createdAt: new Date("2026-04-20T00:00:00Z"),
          partyJoinedAt: new Date("2026-04-20T00:00:00Z"),
          careerHistory: [],
          executiveTermsServed: 0,
        },
      },
    } as never;
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(authResult);
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue(authResult);

    const { findBlockingActiveCandidacy } = await import("@/lib/elections/activeCandidacy");
    vi.mocked(findBlockingActiveCandidacy).mockResolvedValue(null);
  });

  it("treats a duplicate general-election entry insert as already entered", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439031");
    const characterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");

    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionId,
        electionType: "governor",
        state: "US-CA",
        countryId: "US",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const electionCandidates = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        _id: new ObjectId(),
        electionId,
        characterId,
        characterName: "Test Character",
        party: "1",
        status: "active",
        enteredAt: new Date(),
      }),
      find: vi.fn().mockReturnValue(emptyFindCursor()),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: electionCandidates index: unique_active_election_candidate_per_character dup key",
            { characterId: 1 }
          )
        ),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        electionCandidates,
      }) as never
    );

    const { POST } = await import("./[id]/enter/route");
    const req = new Request(`http://localhost/api/elections/${electionId.toString()}/enter`, {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: electionId.toString() }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "You are already entered in this race",
    });
  });

  it("treats a duplicate national leadership insert as another active position race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439041");
    const otherElectionId = new ObjectId("507f1f77bcf86cd799439042");
    const characterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");

    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
    } as never);

    const nationalPartyElections = {
      findOne: vi.fn().mockResolvedValue({
        _id: electionId,
        partyId: "1",
        countryId: "US",
        position: "chair",
        status: "voting",
      }),
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    };

    const nationalPartyCandidates = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        _id: new ObjectId(),
        electionId: otherElectionId,
        characterId,
        characterName: "Test Character",
        partyId: "1",
        countryId: "US",
        position: "viceChair",
        status: "active",
        enteredAt: new Date(),
      }),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: nationalPartyCandidates index: unique_active_national_party_candidate_per_member dup key",
            { partyId: 1, characterId: 1 }
          )
        ),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        nationalPartyElections,
        nationalCommitteeElections: {
          findOne: vi.fn().mockResolvedValue(null),
        },
        nationalPartyCandidates,
      }) as never
    );

    const { POST } = await import("../country/[code]/parties/[id]/election/enter/route");
    const req = new Request("http://localhost/api/country/us/parties/1/election/enter", {
      method: "POST",
      body: JSON.stringify({ position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "1" }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "You are already running for National Vice Chair. Withdraw first.",
    });
  });

  it("treats a duplicate committee insert as already a candidate", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439051");
    const characterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");

    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
    } as never);

    const nationalCommitteeCandidates = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        _id: new ObjectId(),
        electionId,
        characterId,
        characterName: "Test Character",
        partyId: "1",
        countryId: "US",
        status: "active",
        enteredAt: new Date(),
      }),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: nationalCommitteeCandidates index: unique_active_national_committee_candidate_per_member dup key",
            { partyId: 1, characterId: 1 }
          )
        ),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        nationalPartyElections: {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        },
        nationalCommitteeElections: {
          findOne: vi.fn().mockResolvedValue({
            _id: electionId,
            partyId: "1",
            countryId: "US",
            status: "voting",
          }),
        },
        nationalCommitteeCandidates,
      }) as never
    );

    const { POST } = await import("../country/[code]/parties/[id]/committee/enter/route");
    const req = new Request("http://localhost/api/country/us/parties/1/committee/enter", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "1" }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "You are already a candidate in this election",
    });
  });

  it("treats a duplicate state leadership insert as another active position race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439061");
    const otherElectionId = new ObjectId("507f1f77bcf86cd799439062");
    const characterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { validateStatePartyElectionAccess } =
      await import("@/lib/utils/statePartyElectionValidation");

    vi.mocked(validateStatePartyElectionAccess).mockResolvedValue({
      success: true,
      character: {
        _id: characterId,
        userId: new ObjectId("507f1f77bcf86cd799439011"),
        name: "Test Character",
        createdAt: new Date("2026-04-20T00:00:00Z"),
      },
      election: {
        _id: electionId,
        stateId: "US-CA",
        partyId: "1",
        countryId: "US",
        position: "chair",
        status: "voting",
      },
      stateId: "US-CA",
      partyId: "1",
    } as never);

    const statePartyCandidates = {
      findOne: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
        _id: new ObjectId(),
        electionId: otherElectionId,
        characterId,
        characterName: "Test Character",
        stateId: "US-CA",
        partyId: "1",
        countryId: "US",
        position: "viceChair",
        status: "active",
        enteredAt: new Date(),
      }),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: statePartyCandidates index: unique_active_state_party_candidate_per_member dup key",
            { stateId: 1, partyId: 1, characterId: 1 }
          )
        ),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        statePartyElections: {
          findOne: vi.fn().mockResolvedValue(null),
        },
        statePartyCandidates,
      }) as never
    );

    const { POST } =
      await import("../country/[code]/region/[id]/party/[partyId]/election/enter/route");
    const req = new Request("http://localhost/api/country/us/region/US-CA/party/1/election/enter", {
      method: "POST",
      body: JSON.stringify({ position: "chair" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ code: "us", id: "US-CA", partyId: "1" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "You are already running for Vice Chair. Withdraw first.",
    });
  });

  it("returns the winning active endorsement when a concurrent endorsement insert loses the race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439071");
    const candidateId = new ObjectId("507f1f77bcf86cd799439072");
    const voterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");

    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionId,
        electionType: "president",
        state: "US",
        countryId: "US",
        status: "active",
      },
    } as never);

    const playerEndorsements = {
      find: vi.fn().mockReturnValue(emptyFindCursor()),
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: playerEndorsements index: unique_active_player_endorsement_per_election dup key",
            { characterId: 1, electionId: 1 }
          )
        ),
      findOne: vi.fn().mockResolvedValue({
        _id: new ObjectId("507f1f77bcf86cd799439073"),
        characterId: voterId,
        characterName: "Test Character",
        electionId,
        candidateId,
        candidateName: "Winning Candidate",
        isActive: true,
        createdAt: new Date(),
      }),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        electionCandidates: {
          findOne: vi.fn().mockResolvedValue({
            _id: candidateId,
            electionId,
            characterId: new ObjectId("507f1f77bcf86cd799439074"),
            characterName: "Winning Candidate",
            status: "active",
          }),
        },
        playerEndorsements,
      }) as never
    );

    const { POST } = await import("./[id]/endorse/route");
    const req = new Request(`http://localhost/api/elections/${electionId.toString()}/endorse`, {
      method: "POST",
      body: JSON.stringify({ candidateId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: electionId.toString() }) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      endorsement: {
        candidateId: candidateId.toString(),
        candidateName: "Winning Candidate",
      },
    });
  });

  it("retries national party vote writes after a duplicate voter-row race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439081");
    const candidateId = new ObjectId("507f1f77bcf86cd799439082");
    const _voterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");

    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
    } as never);

    const nationalPartyVotes = {
      updateOne: vi
        .fn()
        .mockRejectedValueOnce(
          duplicateKeyError(
            "E11000 duplicate key error collection: nationalPartyVotes index: unique_national_party_vote_per_voter dup key",
            { electionId: 1, voterId: 1 }
          )
        )
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 }),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        nationalPartyElections: {
          findOne: vi.fn().mockResolvedValue({
            _id: electionId,
            partyId: "1",
            countryId: "US",
            position: "chair",
            status: "voting",
          }),
        },
        nationalPartyCandidates: {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(),
            electionId,
            characterId: candidateId,
            characterName: "Winning Candidate",
            status: "active",
          }),
        },
        nationalPartyVotes,
      }) as never
    );

    const { POST } = await import("../country/[code]/parties/[id]/election/vote/route");
    const req = new Request("http://localhost/api/country/us/parties/1/election/vote", {
      method: "POST",
      body: JSON.stringify({ candidateId: candidateId.toString(), position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "1" }) });

    expect(res.status).toBe(200);
    expect(nationalPartyVotes.updateOne).toHaveBeenCalledTimes(2);
    expect(nationalPartyVotes.updateOne.mock.calls[1]?.[2]).toBeUndefined();
  });

  it("retries state party vote writes after a duplicate voter-row race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439091");
    const candidateId = new ObjectId("507f1f77bcf86cd799439092");
    const voterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { validateStatePartyElectionAccess } =
      await import("@/lib/utils/statePartyElectionValidation");

    vi.mocked(validateStatePartyElectionAccess).mockResolvedValue({
      success: true,
      character: {
        _id: voterId,
        userId: new ObjectId("507f1f77bcf86cd799439011"),
        name: "Test Character",
        createdAt: new Date("2026-04-20T00:00:00Z"),
        partyJoinedAt: new Date("2026-04-20T00:00:00Z"),
      },
      election: {
        _id: electionId,
        stateId: "US-CA",
        partyId: "1",
        countryId: "US",
        position: "chair",
        status: "voting",
      },
      stateId: "US-CA",
      partyId: "1",
    } as never);

    const statePartyVotes = {
      updateOne: vi
        .fn()
        .mockRejectedValueOnce(
          duplicateKeyError(
            "E11000 duplicate key error collection: statePartyVotes index: unique_state_party_vote_per_voter dup key",
            { electionId: 1, voterId: 1 }
          )
        )
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 }),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        statePartyCandidates: {
          findOne: vi.fn().mockResolvedValue({
            _id: new ObjectId(),
            electionId,
            characterId: candidateId,
            characterName: "State Winner",
            status: "active",
          }),
        },
        statePartyVotes,
      }) as never
    );

    const { POST } =
      await import("../country/[code]/region/[id]/party/[partyId]/election/vote/route");
    const req = new Request("http://localhost/api/country/us/region/US-CA/party/1/election/vote", {
      method: "POST",
      body: JSON.stringify({ candidateId: candidateId.toString(), position: "chair" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ code: "us", id: "US-CA", partyId: "1" }),
    });

    expect(res.status).toBe(200);
    expect(statePartyVotes.updateOne).toHaveBeenCalledTimes(2);
    expect(statePartyVotes.updateOne.mock.calls[1]?.[2]).toBeUndefined();
  });

  it("retries committee vote writes after a duplicate voter-row race", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd7994390a1");
    const candidateId = new ObjectId("507f1f77bcf86cd7994390a2");
    const _voterId = new ObjectId("507f1f77bcf86cd799439021");
    const { getDb } = await import("@/lib/mongodb");
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");

    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
    } as never);

    const nationalCommitteeVotes = {
      updateOne: vi
        .fn()
        .mockRejectedValueOnce(
          duplicateKeyError(
            "E11000 duplicate key error collection: nationalCommitteeVotes index: unique_national_committee_vote_per_voter dup key",
            { electionId: 1, voterId: 1 }
          )
        )
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 }),
    };

    vi.mocked(getDb).mockResolvedValue(
      mockDbWithCollections({
        users: {
          findOne: vi.fn().mockResolvedValue({ createdAt: new Date("2026-04-20T00:00:00Z") }),
        },
        nationalCommitteeElections: {
          findOne: vi.fn().mockResolvedValue({
            _id: electionId,
            partyId: "1",
            countryId: "US",
            status: "voting",
          }),
        },
        nationalCommitteeCandidates: {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([
              {
                _id: new ObjectId(),
                electionId,
                characterId: candidateId,
                characterName: "Committee Winner",
                status: "active",
              },
            ]),
          }),
        },
        nationalCommitteeVotes,
      }) as never
    );

    const { POST } = await import("../country/[code]/parties/[id]/committee/vote/route");
    const req = new Request("http://localhost/api/country/us/parties/1/committee/vote", {
      method: "POST",
      body: JSON.stringify({ candidateIds: [candidateId.toString()] }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "1" }) });

    expect(res.status).toBe(200);
    expect(nationalCommitteeVotes.updateOne).toHaveBeenCalledTimes(2);
    expect(nationalCommitteeVotes.updateOne.mock.calls[1]?.[2]).toBeUndefined();
  });
});
