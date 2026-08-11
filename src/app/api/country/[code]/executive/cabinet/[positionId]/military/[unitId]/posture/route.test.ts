import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/posture/route";
const UID = "507f1f77bcf86cd799439011";

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = {
  params: Promise.resolve({ code: "us", positionId: "secretary_of_defense", unitId: UID }),
};

describe("POST military/[unitId]/posture", () => {
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
    db.collectionMocks.militaryUnits.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    // Default target unit sits in reserve (Garrison allowed).
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ theaterId: "reserve" });
  });

  it("sets the posture (free, no action spend)", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "forward" }), call);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryUnits.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US" }),
      { $set: { posture: "forward" } }
    );
    expect(db.collectionMocks.cabinetMembers.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an invalid posture", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "nuke" }), call);
    expect(res.status).toBe(400);
  });

  it("404s when the unit is missing", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "alert" }), call);
    expect(res.status).toBe(404);
  });

  it("rejects Garrison for a unit deployed to a conflict, without writing", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ theaterId: "afghan" });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "garrison" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("allows Garrison for a unit in reserve", async () => {
    // findOne default is reserve.
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "garrison" }), call);
    expect(res.status).toBe(200);
  });

  it("allows a non-Garrison posture (e.g. Alert) at a front", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ theaterId: "afghan" });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ posture: "alert" }), call);
    expect(res.status).toBe(200);
  });
});
