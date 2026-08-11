import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/statePartyElections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/statePartyElections")>(
    "@/lib/statePartyElections"
  );
  return {
    ...actual,
    notifyLeadershipAppointed: vi.fn(),
    notifyLeadershipRemovedByAdmin: vi.fn(),
  };
});

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
    admin: { username: "admin", isAdmin: true },
  } as never);

  db.collection("characters");
  db.collection("statePartyOrg");
  db.collection("adminLogs");
  db.collectionMocks.adminLogs!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
}

describe("POST /api/admin/state-party/[stateId]/[partyId]/appoint", () => {
  it("clears an older state leadership seat when appointing the same character elsewhere", async () => {
    await setup();

    const appointeeId = new ObjectId();
    const orgId = "MN_7";

    db.collectionMocks
      .characters!.findOne.mockResolvedValueOnce({
        _id: appointeeId,
        name: "Danica Roem",
        homeState: "MN",
        party: "7",
        userId: new ObjectId(),
      })
      .mockResolvedValueOnce({
        _id: appointeeId,
        name: "Danica Roem",
        userId: new ObjectId(),
      });

    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue({
      _id: orgId,
      chairId: null,
      viceChairId: appointeeId,
      treasurerId: null,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/state-party/MN/7/appoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "chair", characterId: appointeeId.toString() }),
      }),
      { params: Promise.resolve({ stateId: "mn", partyId: "7" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.statePartyOrg!.updateOne).toHaveBeenCalledWith(
      { _id: orgId },
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
