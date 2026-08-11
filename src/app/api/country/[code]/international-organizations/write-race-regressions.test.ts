import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/api/requireForeignMinister", () => ({
  requireForeignMinister: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(123),
}));

vi.mock("@/lib/internationalOrganizations/service", () => ({
  getMembers: vi.fn(),
  hasOpenMembershipProposal: vi.fn(),
  isMember: vi.fn(),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: vi.fn(),
}));

// The vote gate is now "is a voting member", so the access table stands in for
// the membership stub these cases already carry.
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn().mockResolvedValue({ US: { enabledForPlayers: true } }),
}));

vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(),
}));

function duplicateKeyError(message: string, keyPattern: Record<string, number>) {
  return Object.assign(new Error(message), { code: 11000, keyPattern });
}

describe("International-organization write race regressions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        character: {
          _id: new ObjectId("507f1f77bcf86cd799439021"),
          name: "Foreign Minister",
          countryId: "US",
        },
      },
    } as never);

    const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        characterId: new ObjectId("507f1f77bcf86cd799439021"),
        characterName: "Foreign Minister",
      },
    } as never);
  });

  it("rewrites leadership-election votes atomically instead of appending duplicate country rows", async () => {
    const electionId = new ObjectId("507f1f77bcf86cd799439031");
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    const { getDb } = await import("@/lib/mongodb");
    const { isMember } = await import("@/lib/internationalOrganizations/service");

    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.spyOn(
      await import("@/lib/db/collections"),
      "getOrganizationLeadershipElectionsCollection"
    ).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({
        _id: electionId,
        organizationId: "eu",
        status: "pending",
        votes: [
          {
            countryId: "US",
            characterId: new ObjectId(),
            characterName: "Old Vote",
            vote: "yes",
            castAt: new Date("2026-04-29T12:00:00Z"),
            castOnTurn: 120,
          },
        ],
      }),
      updateOne,
    } as never);

    const { POST } = await import("./leadership-elections/[electionId]/vote/route");
    const res = await POST(
      new Request(
        `http://localhost/api/country/us/international-organizations/leadership-elections/${electionId.toString()}/vote`,
        {
          method: "POST",
          body: JSON.stringify({ vote: "no" }),
        }
      ),
      { params: Promise.resolve({ code: "us", electionId: electionId.toString() }) }
    );

    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, pipeline] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: electionId, status: "pending" });
    expect(pipeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $set: expect.objectContaining({
            votes: expect.objectContaining({
              $concatArrays: expect.any(Array),
            }),
          }),
        }),
      ])
    );
  });

  it("treats a concurrent org leadership nomination insert as an active election", async () => {
    const candidateId = new ObjectId("507f1f77bcf86cd799439041");
    const { getDb } = await import("@/lib/mongodb");
    const service = await import("@/lib/internationalOrganizations/service");
    const { getHeadOfGovernmentCharacterId } = await import("@/lib/api/headOfGovernment");

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: candidateId,
              name: "Candidate",
            }),
          };
        }
        // diplomaticActions (and any other collection): a fresh budget so the
        // action gate passes and the duplicate-key insert path is reached.
        return {
          findOne: vi.fn().mockResolvedValue(null),
          updateOne: vi.fn().mockResolvedValue({}),
        };
      }),
    } as never);
    vi.mocked(service.loadOrganizationDef).mockResolvedValue({
      id: "eu",
      leadership: { title: "Secretary-General", termTurns: 48 },
    } as never);
    vi.mocked(service.isMember).mockResolvedValue(true);
    vi.mocked(service.getMembers).mockResolvedValue(["US"]);
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(null);

    vi.spyOn(
      await import("@/lib/db/collections"),
      "getOrganizationLeadershipCollection"
    ).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(
      await import("@/lib/db/collections"),
      "getOrganizationLeadershipElectionsCollection"
    ).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: organizationLeadershipElections index: unique_pending_org_leadership_election_per_org dup key",
            { organizationId: 1 }
          )
        ),
    } as never);
    vi.spyOn(
      await import("@/lib/db/collections/cabinetMembers"),
      "getCabinetMembersCollection"
    ).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({
        countryId: "US",
        positionId: "foreign-minister",
        characterId: candidateId,
      }),
    } as never);

    const { POST } = await import("./[orgId]/leadership/nominate/route");
    const res = await POST(
      new Request(
        "http://localhost/api/country/us/international-organizations/eu/leadership/nominate",
        {
          method: "POST",
          body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
        }
      ),
      { params: Promise.resolve({ code: "us", orgId: "eu" }) }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "A leadership election is already underway for this organization.",
    });
  });

  it("treats a concurrent membership proposal insert as already open", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const service = await import("@/lib/internationalOrganizations/service");

    vi.mocked(getDb).mockResolvedValue({
      // diplomaticActions: a fresh budget so the action gate passes and the
      // duplicate-key insert path is reached.
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue(null),
        updateOne: vi.fn().mockResolvedValue({}),
      })),
    } as never);
    vi.mocked(service.loadOrganizationDef).mockResolvedValue({ id: "eu" } as never);
    vi.mocked(service.isMember).mockResolvedValue(false);
    vi.mocked(service.hasOpenMembershipProposal).mockResolvedValue(false);

    vi.spyOn(
      await import("@/lib/db/collections"),
      "getOrganizationProposalsCollection"
    ).mockResolvedValue({
      insertOne: vi
        .fn()
        .mockRejectedValue(
          duplicateKeyError(
            "E11000 duplicate key error collection: organizationMembershipProposals index: unique_pending_org_membership_proposal_per_country dup key",
            { organizationId: 1, proposingCountryId: 1 }
          )
        ),
    } as never);

    const { POST } = await import("./[orgId]/propose-join/route");
    const res = await POST(
      new Request("http://localhost/api/country/us/international-organizations/eu/propose-join", {
        method: "POST",
      }),
      { params: Promise.resolve({ code: "us", orgId: "eu" }) }
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "US already has an open membership proposal for eu.",
    });
  });
});
