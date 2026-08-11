import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { isAdmin: true },
  } as never);

  db.collection("characters");
  db.collection("politicalParties");
}

describe("POST /api/admin/country/[code]/parties/[partyId]/appoint", () => {
  it("clears an older national leadership seat when appointing the same character elsewhere", async () => {
    await setup();

    const appointeeId = new ObjectId();
    const partyDoc = {
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
      chairId: null,
      viceChairId: appointeeId,
      treasurerId: null,
      name: "Example Party",
    };

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(partyDoc as never);

    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: appointeeId,
      name: "Danica Roem",
      party: "7",
      countryId: "US",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/country/us/parties/7/appoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "chair", characterId: appointeeId.toString() }),
      }),
      { params: Promise.resolve({ code: "us", partyId: "7" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.politicalParties!.updateOne).toHaveBeenCalledWith(
      { _id: partyDoc._id },
      {
        $set: {
          viceChairId: null,
          chairId: appointeeId,
          updatedAt: expect.any(Date),
        },
      }
    );
  });
});
