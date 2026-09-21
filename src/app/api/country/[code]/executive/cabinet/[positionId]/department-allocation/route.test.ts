import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

const url =
  "http://localhost/api/country/us/executive/cabinet/secretary_of_health/department-allocation";

function request(allocations: Record<string, number>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      departmentId: "us_health_department",
      programAllocationPercents: allocations,
    }),
  });
}

describe("POST department allocation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user_1", isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 42,
      departmentFinanceEnabled: true,
    } as never);

    db.collection("cabinetMembers");
    db.collection("federalBudget");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({ characterId: "char_1" });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      departmentAccounts: {
        us_health_department: {
          programs: {
            public_health: { programId: "public_health", status: "operating" },
            rural_health: { programId: "rural_health", status: "authorized" },
            repealed_program: { programId: "repealed_program", status: "closed" },
          },
        },
      },
    });
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("persists a complete allocation for the office holder", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/department-allocation/route");
    const response = await POST(request({ public_health: 70, rural_health: 30 }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_health" }),
    });

    expect(response.status).toBe(200);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "US",
        $or: expect.any(Array),
      }),
      {
        $set: expect.objectContaining({
          "departmentAccounts.us_health_department.programAllocationPercents": {
            public_health: 70,
            rural_health: 30,
          },
          "departmentAccounts.us_health_department.lastAllocationChangedTurn": 42,
          "departmentAccounts.us_health_department.lastAllocationChangedBy": "char_1",
        }),
      }
    );
  });

  it("rejects partial allocations without writing", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/department-allocation/route");
    const response = await POST(request({ public_health: 100 }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_health" }),
    });

    expect(response.status).toBe(400);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a user who does not hold the office", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({ characterId: "char_2" });
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/department-allocation/route");
    const response = await POST(request({ public_health: 50, rural_health: 50 }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_health" }),
    });

    expect(response.status).toBe(403);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });

  it("turns a concurrent same-turn write into a conflict", async () => {
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/department-allocation/route");
    const response = await POST(request({ public_health: 50, rural_health: 50 }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_health" }),
    });

    expect(response.status).toBe(409);
  });
});
