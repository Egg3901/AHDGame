import { beforeEach, describe, expect, it, vi } from "vitest";
import { Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn().mockResolvedValue({ currentTurn: 5 }) }));

/**
 * Regression guard for the CN whip-display bug: the national whippable-bills
 * route resolved party legislators with `officeType: { $in: chamberKeys }`.
 * CN delegates are stored under officeType "npcDelegate", not the chamber key
 * "npc", so the lookup matched nobody and the route returned an empty list —
 * CN bills never appeared in the whip panel. Sibling countries are unaffected
 * because their officeType equals their chamber key.
 */
describe("GET /api/country/[code]/parties/[id]/whippable-bills — CN chamber/office mapping", () => {
  let db: MockDb;
  const chairId = new ObjectId("507f1f77bcf86cd799439011");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();

    db.collection("bills");
    db.collection("billWhips");
    db.collection("electedOfficials");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "cn-ccp",
      sequentialId: 1,
      countryId: "CN",
      chairId: null,
      viceChairId: null,
      name: "CCP",
    } as never);
  });

  it("surfaces a CN NPC bill when the party has an npcDelegate, keyed by chamber 'npc'", async () => {
    const billId = new ObjectId("507f1f77bcf86cd799439021");

    db.collectionMocks["bills"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: billId,
          title: "Public Security and Criminal Justice Reform Act",
          status: "active",
          currentChamber: "npc",
          countryId: "CN",
          votingEndsOnTurn: 208,
        },
      ]),
    } as never);

    db.collectionMocks["electedOfficials"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ officeType: "npcDelegate", countryId: "CN", party: "1" }]),
    } as never);

    db.collectionMocks["billWhips"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/cn/parties/1/whippable-bills"),
      { params: Promise.resolve({ code: "cn", id: "1" }) }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<
      string,
      Array<{ bill: { id: string; title: string } }>
    >;

    // Bill must appear under the chamber KEY "npc" (what the UI indexes by).
    expect(body.npc).toHaveLength(1);
    expect(body.npc?.[0]?.bill.title).toBe("Public Security and Criminal Justice Reform Act");

    // The legislator lookup must resolve the chamber key to the office type
    // "npcDelegate" (and stay country-scoped), not query the raw chamber key.
    const officialsFilter = db.collectionMocks["electedOfficials"]!.find.mock.calls[0]![0] as {
      officeType?: { $in?: string[] };
      countryId?: string;
    };
    expect(officialsFilter.officeType?.$in).toContain("npcDelegate");
    expect(officialsFilter.countryId).toBe("CN");
  });
});
