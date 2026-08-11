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
  isOrganizationFoundedLive: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
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
const { spendDiplomaticAction } =
  await import("@/lib/internationalOrganizations/diplomaticActions");

/** db whose gameState carries the flag and whose countryAlignments carries one row. */
function makeDb(opts: {
  alignmentEnabled: boolean;
  shares?: Record<string, number>;
  nonAligned?: number;
}) {
  const proposalInsert = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  const db = {
    collection: (name: string) => ({
      insertOne: proposalInsert,
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      findOne: vi.fn().mockResolvedValue(
        name === "gameState"
          ? {
              _id: "current",
              currentYear: 1979,
              startingYear: 1979,
              intOrgAlignmentEnabled: opts.alignmentEnabled,
            }
          : name === "countryAlignments" && opts.shares
            ? { entityId: "DE", shares: opts.shares, nonAligned: opts.nonAligned ?? 0 }
            : null
      ),
    }),
  } as unknown as Db;
  vi.mocked(getDb).mockResolvedValue(db);
  return { proposalInsert };
}

function authAsDeForeignMinister() {
  const characterId = new ObjectId();
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: characterId, name: "Klaus FM" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: { countryId: "DE", positionId: "foreign_minister", characterId, characterName: "Klaus" },
  } as never);
}

async function post(orgId: string) {
  const { POST } =
    await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-join/route");
  return POST(
    new Request(
      `http://localhost/api/country/de/international-organizations/${orgId}/propose-join`,
      { method: "POST" }
    ),
    { params: Promise.resolve({ code: "de", orgId }) }
  );
}

describe("propose-join — alignment gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAsDeForeignMinister();
    vi.mocked(isMember).mockResolvedValue(false);
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(false);
    vi.mocked(getMembers).mockResolvedValue(["US"] as never);
  });

  it("lets a nation past the gate apply to its own bloc", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    const { proposalInsert } = makeDb({
      alignmentEnabled: true,
      shares: { WEST: 60, EAST: 5 },
      nonAligned: 35,
    });

    const res = await post("NATO");
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalled();
  });

  it("refuses a nation with too little of the bloc, naming the shortfall", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    makeDb({ alignmentEnabled: true, shares: { WEST: 5, EAST: 70 }, nonAligned: 25 });

    const res = await post("NATO");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/holds only 5 of West/i);
  });

  it("refuses a nation inside the deadband, quoting the join share", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    makeDb({ alignmentEnabled: true, shares: { WEST: 30, EAST: 18 }, nonAligned: 52 });

    const res = await post("NATO");
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/short of the 60/i);
  });

  it("does not spend a diplomatic action on a refused application", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    makeDb({ alignmentEnabled: true, shares: { WEST: 5, EAST: 70 }, nonAligned: 25 });

    await post("NATO");
    expect(vi.mocked(spendDiplomaticAction)).not.toHaveBeenCalled();
  });

  it("leaves an org with no channel completely alone", async () => {
    // The UN has no pole, so alignment has no opinion — an Eastern nation may
    // still apply. Reading `null` as ineligible would make the UN unjoinable.
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "UN", name: "United Nations" } as never);
    const { proposalInsert } = makeDb({
      alignmentEnabled: true,
      shares: { WEST: 5, EAST: 70 },
      nonAligned: 25,
    });

    const res = await post("UN");
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalled();
  });

  it("imposes no condition at all when the feature gate is off", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    const { proposalInsert } = makeDb({
      alignmentEnabled: false,
      shares: { WEST: 5, EAST: 70 },
      nonAligned: 25,
    });

    const res = await post("NATO");
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalled();
  });

  it("imposes no condition on a nation with no alignment row yet", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    const { proposalInsert } = makeDb({ alignmentEnabled: true });

    const res = await post("NATO");
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalled();
  });

  it("imposes no alignment condition on the Commonwealth", async () => {
    // It carries influence as a Western channel, but membership answers to
    // shared history, not to how Western a nation currently is.
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "COMMONWEALTH",
      name: "Commonwealth of Nations",
    } as never);
    const { proposalInsert } = makeDb({
      alignmentEnabled: true,
      shares: { WEST: 5, EAST: 70 },
      nonAligned: 25,
    });

    const res = await post("COMMONWEALTH");
    expect(res.status).toBe(200);
    expect(proposalInsert).toHaveBeenCalled();
  });
});
