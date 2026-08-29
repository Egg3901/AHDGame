import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/navair/mission/route";

const UNIT_ID = new ObjectId();

function post(body: unknown) {
  return new Request("http://x/api/…/navair/mission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const call = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("navair mission route", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: true, character: { _id: "char_1" } },
    } as never);
    db.collection("gameState");
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      conflictsEnabled: true,
      currentTurn: 40,
    });
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({
      _id: UNIT_ID,
      countryId: "US",
      domain: "naval",
      station: null,
    });
    db.collectionMocks.militaryUnits.updateOne.mockResolvedValue({ acknowledged: true });
  });

  it("sets a standing mission on a naval formation", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ unitId: String(UNIT_ID), mission: "SEA_CONTROL" }), call);

    expect(res.status).toBe(200);
    const [filter, update] = db.collectionMocks.militaryUnits.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: UNIT_ID });
    expect(update.$set).toMatchObject({ mission: "SEA_CONTROL" });
  });

  /**
   * The body reaches region lookups and error templates, so its shape is the
   * route's own responsibility. These four cases are what the hand-rolled
   * guards asserted before the route moved to parseJsonBody + Zod; they are
   * kept so the swap cannot quietly widen what the endpoint accepts.
   */
  it("rejects a body with no unitId", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ mission: "SEA_CONTROL" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a body that orders nothing at all", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ unitId: String(UNIT_ID) }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  /**
   * The station dropdown sends `{ unitId, station }` with no mission
   * (NavairCommandClient's `send(f.id, { station })`), so a station-only order
   * has to be a legal request or moving a fleet is impossible.
   */
  it("accepts a station-only order and leaves the standing mission alone", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({
      _id: UNIT_ID,
      countryId: "US",
      domain: "naval",
      mission: "BLOCKADE",
      missionTarget: "nat",
      station: "nat",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(post({ unitId: String(UNIT_ID), station: "nat" }), call);

    expect(res.status).toBe(200);
    const [, update] = db.collectionMocks.militaryUnits.updateOne.mock.calls[0];
    expect(update.$set).toEqual({ station: "nat" });
    // Neither field is touched: a move is not a change of orders, and blanking
    // missionTarget here would silently disarm a standing strike.
    expect(update.$set).not.toHaveProperty("mission");
    expect(update.$set).not.toHaveProperty("missionTarget");
  });

  it("still validates the mission against the domain when one is given", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ unitId: String(UNIT_ID), mission: "CAP" }), call);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a non-string station rather than letting it reach a region lookup", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      post({ unitId: String(UNIT_ID), mission: "SEA_CONTROL", station: 7 }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("rejects an empty-string missionTarget", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      post({ unitId: String(UNIT_ID), mission: "SEA_CONTROL", missionTarget: "" }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      new Request("http://x/api/…/navair/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
      call
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
  });

  it("404s an id that is not an ObjectId, without probing the database", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(post({ unitId: "not-an-id", mission: "SEA_CONTROL" }), call);
    expect(res.status).toBe(404);
    expect(db.collectionMocks.militaryUnits.findOne).not.toHaveBeenCalled();
  });
});
