import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

// The waiver and the candidate pool now read the VOTING roll, so these cases
// need an access table. Every country here is player-enabled, which keeps the
// rolls these tests were written against unchanged.
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn().mockResolvedValue(
    new Proxy({} as Record<string, { enabledForPlayers: boolean }>, {
      get: (_t, key) =>
        typeof key === "string" && key !== "then" ? { enabledForPlayers: true } : undefined,
    })
  ),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationDef: vi.fn(),
  isMember: vi.fn(),
  hasOpenMembershipProposal: vi.fn(),
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
  getMembers: vi.fn(),
}));
vi.mock("@/lib/internationalOrganizations/founding", () => ({
  isOrganizationFoundedLive: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/diplomaticActions", () => ({
  getDiplomaticActionsRemaining: vi.fn().mockResolvedValue(4),
  spendDiplomaticAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/internationalOrganizations/commands/buildMembershipBill", () => ({
  buildMembershipBill: vi.fn().mockResolvedValue(new ObjectId()),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { loadOrganizationDef, isMember, hasOpenMembershipProposal, getMembers } =
  await import("@/lib/internationalOrganizations/service");
const { isOrganizationFoundedLive } = await import("@/lib/internationalOrganizations/founding");
const { getCurrentTurn } = await import("@/lib/turn/currentTurn");

function makeDb(): { db: Db; proposalInsert: ReturnType<typeof vi.fn> } {
  const proposalInsert = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  const db = {
    collection: () => ({
      insertOne: proposalInsert,
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(null),
    }),
  } as unknown as Db;
  return { db, proposalInsert };
}

function authAsDeForeignMinister() {
  const characterId = new ObjectId();
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: characterId, name: "Klaus FM" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: {
      countryId: "DE",
      positionId: "foreign_minister",
      characterId,
      characterName: "Klaus FM",
    },
  } as never);
}

const params = { params: Promise.resolve({ code: "de", orgId: "EU" }) };
const request = () =>
  new Request("http://localhost/api/country/de/international-organizations/EU/propose-join", {
    method: "POST",
  });

describe("propose-join — founding gate + empty-org waiver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsDeForeignMinister();
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "EU", name: "European Union" } as never);
    vi.mocked(isMember).mockResolvedValue(false);
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(false);
    vi.mocked(getCurrentTurn).mockResolvedValue(100);
  });

  it("400s when the organization is not yet founded", async () => {
    const { db } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(false);
    vi.mocked(getMembers).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(request(), params);
    expect(res.status).toBe(400);
    const body = await res.json();
    // Shape-agnostic: badRequest().toJson() layout may nest the message.
    expect(JSON.stringify(body)).toMatch(/not yet been founded/i);
  });

  it("stamps orgVoteExempt + orgApproved when applying to a founded empty org", async () => {
    const { db, proposalInsert } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(true);
    vi.mocked(getMembers).mockResolvedValue([]);

    const { POST } = await import("./route");
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalledWith(
      expect.objectContaining({ orgVoteExempt: true, orgApproved: true })
    );
  });

  it("creates a normal proposal (no waiver) when the org has members", async () => {
    const { db, proposalInsert } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(true);
    vi.mocked(getMembers).mockResolvedValue(["US", "UK"] as never);

    const { POST } = await import("./route");
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    const inserted = proposalInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.orgVoteExempt).toBeUndefined();
    expect(inserted.orgApproved).toBeUndefined();
  });
  it("waives the vote for an org whose members all lack one", async () => {
    // Regression: the waiver used to read the full roll while the resolver's
    // unanimity read the voting roll. An org holding only tribute members has a
    // non-empty roll and no voters, so it took neither path — denied the waiver,
    // then failed unanimity for want of anyone to vote, and could never admit
    // anybody again.
    const { db, proposalInsert } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(isOrganizationFoundedLive).mockResolvedValue(true);
    vi.mocked(getMembers).mockResolvedValue(["JO", "AF"] as never);
    const { getAllCountryAccess } = await import("@/lib/countryAccess");
    vi.mocked(getAllCountryAccess).mockResolvedValue({} as never);

    const { POST } = await import("./route");
    const res = await POST(request(), params);
    expect(res.status).toBe(200);
    const inserted = proposalInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.orgVoteExempt).toBe(true);
  });
});
