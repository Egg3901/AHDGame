import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/utils/demographics", () => ({ getStateLean: vi.fn().mockReturnValue(0) }));

const chairId = new ObjectId();
const stateChairId = new ObjectId();
const baseParty = {
  _id: new ObjectId(),
  sequentialId: 9,
  countryId: "US",
  chairId,
  viceChairId: null,
  name: "Reform",
  priorityRegion: { stateIds: ["CA"] },
};

async function setupMocks(db: MockDb) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), isAdmin: false, character: { _id: chairId } },
  } as never);
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  vi.mocked(findPartyBySequentialId).mockResolvedValue(baseParty as never);
}

describe("GET /api/country/[code]/parties/[id]/state-parties", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    await setupMocks(db);
  });

  it("aggregates org/PS/treasury/regPct/chair/nppCount/target per region", async () => {
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", name: "California" },
        { _id: "WY", name: "Wyoming" },
      ]),
    } as never);
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          stateId: "CA",
          partyId: "9",
          organization: 70,
          politicalStrength: 40,
          treasury: 500000,
          registration: 55,
          chairId: stateChairId,
          hasPresence: true,
        },
      ]),
    } as never);
    db.collection("npps").aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", count: 3 }]),
    } as never);
    db.collection("characters").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: stateChairId, name: "Ada Lovelace" }]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(2);
    const ca = body.rows.find((r: { regionId: string }) => r.regionId === "CA");
    expect(ca).toMatchObject({
      regionId: "CA",
      organization: 70,
      politicalStrength: 40,
      treasury: 500000,
      registrationPct: 55,
      chairName: "Ada Lovelace",
      nppCount: 3,
      isTarget: true,
      hasPresence: true,
    });
    const wy = body.rows.find((r: { regionId: string }) => r.regionId === "WY");
    expect(wy).toMatchObject({ organization: 0, chairName: null, nppCount: 0, isTarget: false });
  });

  it("rejects a non-member, non-leadership viewer", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: new ObjectId(), party: "1" },
      },
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });
    expect(response.status).toBe(403);
  });
});
