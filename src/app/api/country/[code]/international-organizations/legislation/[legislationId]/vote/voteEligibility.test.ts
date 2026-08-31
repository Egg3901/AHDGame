import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(123) }));
vi.mock("@/lib/db/collections", () => ({ getOrganizationLegislationCollection: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/orgMembership", () => ({ isVotingMember: vi.fn() }));
const upsertPendingOrganizationVote = vi.fn().mockResolvedValue({ matchedCount: 1 });
vi.mock("@/lib/internationalOrganizations/voteWrite", () => ({
  upsertPendingOrganizationVote: (...args: unknown[]) => upsertPendingOrganizationVote(...args),
}));

const LEG_ID = "507f1f77bcf86cd7994390e1";

const post = async () => {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/vote", {
      method: "POST",
      body: JSON.stringify({ vote: "yes" }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ code: "us", legislationId: LEG_ID }) }
  );
};

describe("free trade agreement vote eligibility", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    upsertPendingOrganizationVote.mockResolvedValue({ matchedCount: 1 });

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

    const collections = await import("@/lib/db/collections");
    vi.mocked(collections.getOrganizationLegislationCollection).mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({
        _id: new ObjectId(LEG_ID),
        organizationId: "NATO",
        type: "free_trade_agreement",
        parties: ["US", "UK"],
        status: "pending",
      }),
    } as never);
  });

  it("refuses a party that no longer holds a vote in the host organization", async () => {
    // Parties are checked against membership when the agreement is tabled, but a
    // country can withdraw, or lose player-enablement, before the vote closes.
    // The resolver drops such a ballot, so the door must refuse it rather than
    // tell the player their vote counted.
    const { isVotingMember } = await import("@/lib/internationalOrganizations/orgMembership");
    vi.mocked(isVotingMember).mockResolvedValue(false);

    const res = await post();

    expect(res.status).toBe(400);
    expect(upsertPendingOrganizationVote).not.toHaveBeenCalled();
  });

  it("accepts a party that is still a voting member", async () => {
    const { isVotingMember } = await import("@/lib/internationalOrganizations/orgMembership");
    vi.mocked(isVotingMember).mockResolvedValue(true);

    const res = await post();

    expect(res.status).toBe(200);
    expect(upsertPendingOrganizationVote).toHaveBeenCalled();
  });
});
