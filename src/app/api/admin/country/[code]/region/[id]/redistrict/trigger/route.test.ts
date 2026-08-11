import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/redistricting/regenerate", () => ({
  regenerateCongressionalDistricts: vi.fn(),
}));

async function callPost(code: string, regionId: string) {
  const { POST } = await import("./route");
  return POST(new Request("http://t/x", { method: "POST" }), {
    params: Promise.resolve({ code, id: regionId }),
  });
}

describe("POST admin redistrict trigger", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "testadmin" },
    } as never);
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ redistrictingEnabled: true } as never);
    const { regenerateCongressionalDistricts } = await import("@/lib/redistricting/regenerate");
    vi.mocked(regenerateCongressionalDistricts).mockResolvedValue({ regenerated: 7 });
  });

  it("rejects non-US countries", async () => {
    const res = await callPost("uk", "ENG");
    expect(res.status).toBe(400);
  });

  it("rejects when redistricting flag is off", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ redistrictingEnabled: false } as never);
    const res = await callPost("us", "TX");
    expect(res.status).toBe(400);
  });

  it("regenerates districts and returns redirect URL", async () => {
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "TX",
      countryId: "US",
      name: "Texas",
    });

    const res = await callPost("us", "TX");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectUrl).toBe("/country/us/region/TX/redistrict");
    expect(body.regenerated).toBe(7);

    const { regenerateCongressionalDistricts } = await import("@/lib/redistricting/regenerate");
    expect(regenerateCongressionalDistricts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ countryId: "US", stateIds: ["TX"] })
    );
  });
});
