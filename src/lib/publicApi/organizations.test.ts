import { ObjectId, type Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationSummaries: vi.fn(),
}));

function summary() {
  return {
    id: "NATO",
    def: {
      id: "NATO",
      name: "North Atlantic Treaty Organization",
      shortName: "NATO",
      description: "Collective defence alliance",
      logoPath: "/orgs/nato.svg",
      foundingMembers: ["US", "UK"],
      leadership: { title: "Secretary General", termTurns: 96 },
      charter: "Members defend one another.",
      category: "security",
    },
    members: [
      {
        countryId: "US",
        countryName: "United States",
        flagEmoji: "US",
        status: "founding",
        joinedTurn: 0,
        hasVote: true,
        isCountry: true,
      },
      {
        countryId: "CA",
        countryName: "Canada",
        flagEmoji: "CA",
        status: "founding",
        joinedTurn: 0,
        hasVote: false,
        isCountry: false,
      },
    ],
    pendingMembershipProposals: [
      {
        _id: new ObjectId("507f1f77bcf86cd799439011"),
        organizationId: "NATO",
        proposingCountryId: "DE",
        proposedByCharacterId: new ObjectId(),
        proposedByCharacterName: "Private Actor",
        status: "pending",
        votes: [
          {
            countryId: "US",
            characterId: new ObjectId(),
            characterName: "Private Voter",
            vote: "yes",
            castAt: new Date("2026-01-01T00:00:00Z"),
            castOnTurn: 10,
          },
        ],
        proposedAt: new Date(),
        proposedOnTurn: 9,
        closesOnTurn: 33,
      },
    ],
    pendingLegislation: [],
    activeLegislation: [],
    pendingWithdrawalMeasures: [],
    leadership: null,
    pendingLeadershipElections: [],
  };
}

describe("public organization queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns compact organization summaries", async () => {
    const { loadOrganizationSummaries } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(loadOrganizationSummaries).mockResolvedValue([summary()] as never);
    const { queryOrganizations } = await import("./organizations");

    const result = await queryOrganizations({} as Db);

    expect(result.organizations[0]).toMatchObject({
      id: "NATO",
      memberCount: 2,
      votingMemberCount: 1,
      activity: { pendingMemberships: 1 },
    });
    expect(result.organizations[0]).not.toHaveProperty("charter");
  });

  it("publishes vote countries while withholding character identifiers", async () => {
    const { loadOrganizationSummaries } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(loadOrganizationSummaries).mockResolvedValue([summary()] as never);
    const { queryOrganization } = await import("./organizations");

    const result = await queryOrganization({} as Db, "nato");

    expect(result).toMatchObject({
      id: "NATO",
      charter: "Members defend one another.",
      membershipProposals: [
        {
          countryId: "DE",
          votes: { totals: { yes: 1, no: 0, abstain: 0 } },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Private Actor");
    expect(JSON.stringify(result)).not.toContain("Private Voter");
    expect(result?.membershipProposals[0]).not.toHaveProperty("proposedByCharacterId");
  });
});
