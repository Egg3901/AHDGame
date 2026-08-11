import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

describe("POST /api/country/[code]/executive/cabinet/[positionId]/setting", () => {
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
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);

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

  it("allows tier setting changes when only allocation was changed this turn", async () => {
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue({
      allocationPercents: { CA: 100 },
      lastAllocationChangedTurn: 100,
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/setting/route");

    const response = await POST(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_treasury/setting",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierSetting: "expansionary" }),
        }
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "US_secretary_of_treasury" },
      expect.objectContaining({
        $set: expect.objectContaining({
          tierSetting: "expansionary",
          lastChangedTurn: 100,
        }),
      }),
      { upsert: true }
    );
  });

  it("allows tier setting after legacy allocation-only lastChangedTurn", async () => {
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue({
      allocationPercents: { CA: 100 },
      lastChangedTurn: 100,
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/setting/route");

    const response = await POST(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_treasury/setting",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierSetting: "expansionary" }),
        }
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }) }
    );

    expect(response.status).toBe(200);
  });

  it("blocks tier setting changes within the 24-turn cooldown", async () => {
    db.collectionMocks.cabinetSettings.findOne.mockResolvedValue({
      tierSetting: "moderate",
      lastChangedTurn: 90,
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/setting/route");

    const response = await POST(
      new Request(
        "http://localhost/api/country/us/executive/cabinet/secretary_of_treasury/setting",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierSetting: "expansionary" }),
        }
      ),
      { params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }) }
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error?: string };
    expect(json.error).toContain("Settings can only be changed once per 24 turns");
    expect(json.error).toContain("14 turns remaining");
  });
});
