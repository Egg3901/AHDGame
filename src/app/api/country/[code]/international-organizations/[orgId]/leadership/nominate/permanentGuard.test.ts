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
  getMembers: vi.fn().mockResolvedValue(["UK", "NG"]),
  isMember: vi.fn().mockResolvedValue(true),
  loadOrganizationDef: vi.fn(),
  recordOrgHistoryEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(100) }));
vi.mock("@/lib/internationalOrganizations/diplomaticActions", () => ({
  getDiplomaticActionsRemaining: vi.fn().mockResolvedValue(4),
  spendDiplomaticAction: vi.fn().mockResolvedValue(undefined),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { loadOrganizationDef } = await import("@/lib/internationalOrganizations/service");

describe("nominate — permanent leadership guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const characterId = new ObjectId();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: { _id: characterId, name: "PM Example" },
      },
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: true,
      auth: {
        countryId: "UK",
        positionId: "foreign_secretary",
        characterId,
        characterName: "PM Example",
      },
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      }),
    } as unknown as Db);
  });

  it("400s for a permanent-leadership org", async () => {
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      id: "COMMONWEALTH",
      name: "Commonwealth of Nations",
      permanentLeadership: { countryId: "UK" },
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request(
        "http://localhost/api/country/uk/international-organizations/COMMONWEALTH/leadership/nominate",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
        }
      ),
      { params: Promise.resolve({ code: "uk", orgId: "COMMONWEALTH" }) }
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/leadership is permanent/i);
  });
});
