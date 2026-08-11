import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
  getPartyIdString: vi.fn(),
  getStatePartyOrgDocumentId: vi.fn(),
}));
vi.mock("@/lib/achievements", () => ({ awardAchievement: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

const realNowMs = new Date("2026-07-12T00:00:00Z").getTime();

let db: MockDb;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  db = createMockDb();
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuth } = await import("@/lib/api/requireAuth");
  const nationalChairId = new ObjectId();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: {
      userId: "user-1",
      username: "chairuser",
      isAdmin: false,
      character: { _id: nationalChairId },
    },
  } as never);

  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: 200,
    effectiveNow: realNowMs,
  } as never);

  const { findPartyBySequentialId, getPartyIdString, getStatePartyOrgDocumentId } =
    await import("@/lib/db/partyLookup");
  vi.mocked(findPartyBySequentialId).mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 7,
    countryId: "US",
    chairId: nationalChairId,
    name: "Example Party",
  } as never);
  vi.mocked(getPartyIdString).mockReturnValue("7");
  vi.mocked(getStatePartyOrgDocumentId).mockReturnValue("MN_7");

  db.collection("states");
  db.collection("characters");
  db.collection("users");
  db.collection("statePartyOrg");
  db.collectionMocks.states!.findOne.mockResolvedValue({
    _id: "MN",
    countryId: "US",
    name: "Minnesota",
  });
}

describe("POST /api/country/[code]/region/[id]/party/[partyId]/leadership", () => {
  it("clears an older state leadership seat when appointing the same character as state chair", async () => {
    await setup();

    const appointeeId = new ObjectId();
    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue({
      _id: "MN_7",
      chairId: null,
      viceChairId: appointeeId,
      treasurerId: null,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: appointeeId,
      name: "Danica Roem",
      party: "7",
      homeState: "MN",
      userId: new ObjectId(),
    });
    db.collectionMocks.users!.findOne.mockResolvedValue({ isBanned: false });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/country/us/region/MN/party/7/leadership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "chair", characterId: appointeeId.toString() }),
      }),
      { params: Promise.resolve({ code: "us", id: "MN", partyId: "7" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.states!.findOne).toHaveBeenCalledWith({ _id: "MN", countryId: "US" });
    expect(db.collectionMocks.statePartyOrg!.updateOne).toHaveBeenCalledWith(
      { _id: "MN_7" },
      {
        $set: {
          viceChairId: null,
          chairId: appointeeId,
          updatedAt: expect.any(Date),
        },
        // A row created here MUST carry countryId, else it is invisible to
        // every countryId-scoped query (build-org spend → missing-row).
        $setOnInsert: expect.objectContaining({ countryId: "US", stateId: "MN", partyId: "7" }),
      },
      { upsert: true }
    );
  });

  it("blocks appointing a character who relocated within the last 24 turns", async () => {
    await setup();

    const appointeeId = new ObjectId();
    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue({
      _id: "MN_7",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: appointeeId,
      name: "Recent Mover",
      party: "7",
      homeState: "MN",
      userId: new ObjectId(),
      lastRelocatedTurn: 190, // 200 - 190 = 10 turns served < 24
    });
    db.collectionMocks.users!.findOne.mockResolvedValue({ isBanned: false });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/country/us/region/MN/party/7/leadership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "chair", characterId: appointeeId.toString() }),
      }),
      { params: Promise.resolve({ code: "us", id: "MN", partyId: "7" }) }
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.turnsRemaining).toBe(14); // 24 - 10
    expect(db.collectionMocks.statePartyOrg!.updateOne).not.toHaveBeenCalled();
  });

  it("allows appointing a character settled in-state for 24+ turns", async () => {
    await setup();

    const appointeeId = new ObjectId();
    db.collectionMocks.statePartyOrg!.findOne.mockResolvedValue({
      _id: "MN_7",
      chairId: null,
      viceChairId: null,
      treasurerId: null,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: appointeeId,
      name: "Settled Member",
      party: "7",
      homeState: "MN",
      userId: new ObjectId(),
      lastRelocatedTurn: 100, // 200 - 100 = 100 turns served >= 24
    });
    db.collectionMocks.users!.findOne.mockResolvedValue({ isBanned: false });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/country/us/region/MN/party/7/leadership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "chair", characterId: appointeeId.toString() }),
      }),
      { params: Promise.resolve({ code: "us", id: "MN", partyId: "7" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.statePartyOrg!.updateOne).toHaveBeenCalled();
  });
});
