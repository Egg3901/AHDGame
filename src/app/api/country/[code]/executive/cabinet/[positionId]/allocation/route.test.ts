import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

describe("POST /api/country/[code]/executive/cabinet/[positionId]/allocation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        character: { _id: "char_1" },
      },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 42 } as never);

    db.collection("cabinetMembers");
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      characterId: "char_1",
    });
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.cabinetSettings.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("accepts the canonical allocations payload", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/allocation/route");

    const response = await POST(
      new Request("http://localhost/api/country/uk/executive/cabinet/chancellor/allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: {
            ENG: 50,
            SCO: 25,
            WAL: 15,
            NIR: 10,
          },
        }),
      }),
      { params: Promise.resolve({ code: "uk", positionId: "chancellor" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "UK_chancellor" },
      expect.objectContaining({
        $set: expect.objectContaining({
          allocationPercents: {
            ENG: 50,
            SCO: 25,
            WAL: 15,
            NIR: 10,
          },
          lastAllocationChangedTurn: 42,
        }),
      }),
      { upsert: true }
    );
  });

  it("allows allocation when tier setting was changed this turn", async () => {
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue({
      tierSetting: "moderate",
      lastChangedTurn: 42,
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/allocation/route");

    const response = await POST(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_treasury/allocation",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocations: { CA: 50, TX: 50 },
          }),
        }
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }) }
    );

    expect(response.status).toBe(200);
  });

  it("accepts legacy allocationPercents payloads for compatibility", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/allocation/route");

    const response = await POST(
      new Request("http://localhost/api/country/uk/executive/cabinet/chancellor/allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationPercents: {
            ENG: 40,
            SCO: 30,
            WAL: 20,
            NIR: 10,
          },
        }),
      }),
      { params: Promise.resolve({ code: "uk", positionId: "chancellor" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "UK_chancellor" },
      expect.objectContaining({
        $set: expect.objectContaining({
          allocationPercents: {
            ENG: 40,
            SCO: 30,
            WAL: 20,
            NIR: 10,
          },
        }),
      }),
      { upsert: true }
    );
  });
});
