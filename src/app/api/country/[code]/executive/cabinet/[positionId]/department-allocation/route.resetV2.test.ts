import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/resetVersions/availability", () => ({
  RESET_V2_READY: { metrics: true, legislation: false, cabinet: true },
}));
vi.mock("@/lib/resetCabinet/setDepartmentAllocations", () => ({
  setResetDepartmentAllocations: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");
const { setResetDepartmentAllocations } =
  await import("@/lib/resetCabinet/setDepartmentAllocations");
const { POST } =
  await import("@/app/api/country/[code]/executive/cabinet/[positionId]/department-allocation/route");

const params = Promise.resolve({ code: "us", positionId: "secretary_of_health" });
const url =
  "http://localhost/api/country/us/executive/cabinet/secretary_of_health/department-allocation";
const receipt = (revision: number) => ({
  worldId: "reset-world",
  revision,
  sourceTurn: 1,
  completedAt: "1991-01-01T00:00:00.000Z",
  verificationHash: "verified",
});

function request() {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      departmentId: "us_health_department",
      programAllocationPercents: { L18: 50, L19: 150 },
    }),
  });
}

describe("v2 Cabinet allocation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", isAdmin: false, character: { _id: "character-1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 20,
      resetWorldId: "reset-world",
      metricsSystemVersion: "v2",
      cabinetSystemVersion: "v2",
      resetVersionSeeds: {
        metrics: receipt(RESET_V2_SEED_REVISION.metrics),
        cabinet: receipt(RESET_V2_SEED_REVISION.cabinet),
      },
    } as never);
    db.collection("cabinetMembers").findOne.mockResolvedValue({ characterId: "character-1" });
    vi.mocked(setResetDepartmentAllocations).mockResolvedValue({ ok: true });
  });

  it("sends a complete request to the v2 world account, not the v1 budget", async () => {
    const response = await POST(request(), { params });
    expect(response.status).toBe(200);
    expect(setResetDepartmentAllocations).toHaveBeenCalledWith(
      expect.objectContaining({
        worldId: "reset-world",
        countryId: "US",
        departmentId: "us_health_department",
        turn: 20,
        allocations: { L18: 50, L19: 150 },
      })
    );
    expect((await getDb()).collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });

  it("requires the current office holder before touching the account", async () => {
    const db = await getDb();
    vi.mocked(db.collection("cabinetMembers").findOne).mockResolvedValue({
      characterId: "other-character",
    });
    const response = await POST(request(), { params });
    expect(response.status).toBe(403);
    expect(setResetDepartmentAllocations).not.toHaveBeenCalled();
  });
});
