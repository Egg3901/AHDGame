import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeRequest(search = "") {
  return new Request(`http://localhost/api/country/us/parties${search}`);
}

describe("GET /api/country/[code]/parties", () => {
  let db: MockDb;
  let partyObjectId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    partyObjectId = new ObjectId();

    // One party with no leadership so leader/member sub-queries stay empty.
    const partyDoc = {
      _id: partyObjectId,
      sequentialId: 7,
      countryId: "US",
      name: "Test Party",
      abbreviation: "TP",
      color: "#123456",
      discordInviteUrl: null,
      economicPosition: 0,
      socialPosition: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: 0,
      isDefault: false,
      regimeStatus: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };

    db.collectionMocks.politicalParties = db.collection("politicalParties");
    db.collectionMocks.politicalParties.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([partyDoc]),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("includes objectId (24-char hex _id) so the merge form can send targetPartyId", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "us" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.parties).toHaveLength(1);
    const [party] = body.parties;
    expect(party.objectId).toBe(partyObjectId.toString());
  });

  it("returns playerCount (0 when no members)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest(), { params: Promise.resolve({ code: "us" }) });
    const body = await res.json();
    const [party] = body.parties;
    expect(party.playerCount).toBe(0);
  });

  it("excludes defunct (merged-away) parties from the active listing", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), { params: Promise.resolve({ code: "us" }) });

    const filter = db.collectionMocks.politicalParties!.find.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(filter.isDefunct).toEqual({ $ne: true });
  });

  it("can include party organization totals in the parties response", async () => {
    db.collectionMocks.statePartyOrg = db.collection("statePartyOrg");
    db.collectionMocks.statePartyOrg.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "7", totalOrg: 42 }]),
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest("?includeOrg=1"), {
      params: Promise.resolve({ code: "us" }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.orgParties).toEqual([
      {
        id: "7",
        name: "Test Party",
        abbreviation: "TP",
        color: "#123456",
        totalOrg: 42,
      },
    ]);
    expect(db.collectionMocks.statePartyOrg.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          countryId: "US",
          partyId: { $in: ["7"] },
          organization: { $gt: 0 },
        },
      },
      { $group: { _id: "$partyId", totalOrg: { $sum: "$organization" } } },
    ]);
  });
});
