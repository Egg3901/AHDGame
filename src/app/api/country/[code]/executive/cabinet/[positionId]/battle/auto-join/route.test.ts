import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/battle/auto-join/route";

function put(body: unknown) {
  return new Request("http://x/api/…/battle/auto-join", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("battle auto-join route", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("conflicts");
    db.collection("theaterState");
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
      sideB: { label: "Warsaw Pact", countries: ["DD", "RU"], kind: "coalition", backer: "east" },
    });
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(3);
    db.collectionMocks.theaterState.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it("stores the standing order for that front", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "afghan", enabled: true }), call);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ theaterId: "afghan", enabled: true });

    const [filter, update, options] = db.collectionMocks.theaterState.updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "US" });
    // Nested key, never the whole map: a nation can hold orders at several fronts.
    expect(update.$set).toEqual({ "autoJoin.afghan": true });
    expect(options).toEqual({ upsert: true });
  });

  it("seeds the defaults a first-time reader expects, and only on insert", async () => {
    const { PUT } = await import(ROUTE);
    await PUT(put({ theaterId: "afghan", enabled: true }), call);
    const [, update] = db.collectionMocks.theaterState.updateOne.mock.calls[0];
    expect(update.$setOnInsert).toEqual({ cohesion: 85, committed: {} });
    // cohesion must not be in $set, or every toggle would reset a nation's cohesion.
    expect(update.$set).not.toHaveProperty("cohesion");
  });

  it("turns the order off again", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "afghan", enabled: false }), call);
    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.theaterState.updateOne.mock.calls[0];
    expect(update.$set).toEqual({ "autoJoin.afghan": false });
  });

  it("refuses a conflict that does not exist", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "nope", enabled: true }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a nation with no side, whose order could never fire", async () => {
    // Same caller and seat, but a war the US is not in. Using a different country here
    // would trip the seat check first and never reach the branch under test.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "afghan",
      sideA: { label: "A", countries: ["UK"], kind: "state" },
      sideB: { label: "B", countries: ["DD"], kind: "state" },
    });
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "afghan", enabled: true }), call);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Your nation has no side in this conflict",
    });
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a malformed body rather than storing a guess", async () => {
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "afghan" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });

  it("refuses when the caller does not hold the seat", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);
    const { PUT } = await import(ROUTE);
    const res = await PUT(put({ theaterId: "afghan", enabled: true }), call);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(db.collectionMocks.theaterState.updateOne).not.toHaveBeenCalled();
  });
});
