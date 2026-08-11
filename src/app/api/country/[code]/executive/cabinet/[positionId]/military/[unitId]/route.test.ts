import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/route";
const UID = "507f1f77bcf86cd799439011";

const call = {
  params: Promise.resolve({ code: "us", positionId: "secretary_of_defense", unitId: UID }),
};

describe("DELETE military/[unitId] (disband)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collection("nationalManpower");
    db.collection("federalBudget");
    db.collection("states");
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({
      _id: UID,
      countryId: "US",
      personnel: 12000,
    });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 100_000,
      mode: "trained",
    });
    db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ population: 100_000_000 }],
    });
  });

  it("disbands the unit", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryUnits.deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US" })
    );
  });

  it("404s when the unit is not in this country", async () => {
    // The pre-read now runs before the delete, so this case must miss on both.
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue(null);
    db.collectionMocks.militaryUnits.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(res.status).toBe(404);
  });

  it("rejects a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "other" } },
    } as never);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(res.status).toBe(403);
  });

  it("returns the unit's personnel to the manpower pool", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(res.status).toBe(200);
    // Guarded $inc, not a read-modify-write.
    expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
      { countryId: "US", pool: { $lte: expect.any(Number) } },
      { $inc: { pool: 12000 } }
    );
  });

  it("returns nothing when the unit does not exist", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue(null);
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(res.status).toBe(404);
    expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
  });

  it("does not credit the treasury on disband", async () => {
    const { DELETE } = await import(ROUTE);
    await DELETE(new Request("http://x", { method: "DELETE" }), call);
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
  });
});
