import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { DiplomaticActionBudget } from "@/lib/db/types/diplomaticAction";
import { DIPLOMATIC_ACTIONS_PER_TURN } from "@/lib/constants/internationalOrganizations";

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
  // The route checks the 0-member waiver; a non-empty roster keeps these
  // budget tests on the normal (no-waiver) path.
  getMembers: vi.fn().mockResolvedValue(["US"]),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { loadOrganizationDef, isMember, hasOpenMembershipProposal } =
  await import("@/lib/internationalOrganizations/service");
const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
const { getDiplomaticActionsRemaining } =
  await import("@/lib/internationalOrganizations/diplomaticActions");

/** db whose "diplomaticActions" collection is a stateful store; others are inert stubs. */
function makeDb(seed: DiplomaticActionBudget[] = []): {
  db: Db;
  proposalInsert: ReturnType<typeof vi.fn>;
} {
  const rows = [...seed];
  const diplomaticActions = {
    async findOne(filter: { countryId: string }) {
      return rows.find((r) => r.countryId === filter.countryId) ?? null;
    },
    async updateOne(
      filter: { countryId: string },
      update: { $set: Partial<DiplomaticActionBudget> },
      opts?: { upsert?: boolean }
    ) {
      let row = rows.find((r) => r.countryId === filter.countryId);
      if (!row) {
        if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
        row = { _id: new ObjectId(), countryId: filter.countryId } as DiplomaticActionBudget;
        rows.push(row);
      }
      Object.assign(row, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  const proposalInsert = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  const billInsert = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  const db = {
    collection: (name: string) => {
      if (name === "diplomaticActions") return diplomaticActions;
      // The Join bill (and FX/treasury) writes go to "bills"; everything else
      // (the membership proposal + its domesticBillId cross-link) shares a stub.
      if (name === "bills") return { insertOne: billInsert };
      return {
        insertOne: proposalInsert,
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
        findOne: vi.fn().mockResolvedValue(null),
      };
    },
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

const params = { params: Promise.resolve({ code: "de", orgId: "NATO" }) };
function request() {
  return new Request(
    "http://localhost/api/country/de/international-organizations/NATO/propose-join",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
}

describe("propose-join — diplomatic budget gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "NATO", name: "NATO" } as never);
    vi.mocked(isMember).mockResolvedValue(false);
    vi.mocked(hasOpenMembershipProposal).mockResolvedValue(false);
    vi.mocked(getCurrentTurn).mockResolvedValue(200);
    authAsDeForeignMinister();
  });

  it("rejects when no diplomatic actions remain", async () => {
    const { db, proposalInsert } = makeDb([
      { _id: new ObjectId(), countryId: "DE", turn: 200, remaining: 0, updatedAt: new Date() },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-join/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "No diplomatic actions remaining this turn." })
    );
    expect(proposalInsert).not.toHaveBeenCalled();
  });

  it("decrements the budget on a successful application", async () => {
    const { db, proposalInsert } = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/propose-join/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(proposalInsert).toHaveBeenCalledTimes(1);
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(
      DIPLOMATIC_ACTIONS_PER_TURN - 1
    );
  });
});
