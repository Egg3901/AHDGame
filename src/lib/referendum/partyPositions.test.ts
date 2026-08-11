import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { declarePartyPosition, withdrawPartyPosition } from "./partyPositions";

vi.mock("@/lib/referendum/wire", () => ({ recordWireEvent: vi.fn().mockResolvedValue(undefined) }));
import { recordWireEvent } from "@/lib/referendum/wire";

const REF_ID = "507f1f77bcf86cd799439011";
const CHAR = new ObjectId();

function setRef(db: MockDb, doc: unknown) {
  db.collectionMocks["referendums"] = db.collection("referendums");
  db.collectionMocks["referendums"].findOne.mockResolvedValue(doc);
}
function lastUpdate(db: MockDb) {
  const calls = db.collectionMocks["referendums"].updateOne.mock.calls;
  return calls[calls.length - 1][1];
}

describe("declarePartyPosition", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("adds a position for a campaigning referendum", async () => {
    setRef(db, { _id: REF_ID, status: "campaigning", regionId: "NIR", partyPositions: [] });
    const r = await declarePartyPosition(db as unknown as Db, {
      referendumId: REF_ID,
      partyId: "8",
      side: "yes",
      declaredByCharacterId: CHAR,
      turn: 50,
      actorName: "SF",
    });
    expect(r.status).toBe(200);
    expect(lastUpdate(db).$set.partyPositions).toEqual([
      { partyId: "8", side: "yes", declaredByCharacterId: CHAR, declaredTurn: 50 },
    ]);
    expect(recordWireEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "declared", summary: expect.stringContaining("SF") })
    );
  });

  it("replaces a party's existing position (one entry per party)", async () => {
    setRef(db, {
      _id: REF_ID,
      status: "campaigning",
      regionId: "NIR",
      partyPositions: [{ partyId: "8", side: "no", declaredByCharacterId: CHAR, declaredTurn: 40 }],
    });
    const r = await declarePartyPosition(db as unknown as Db, {
      referendumId: REF_ID,
      partyId: "8",
      side: "yes",
      declaredByCharacterId: CHAR,
      turn: 50,
    });
    expect(r.status).toBe(200);
    const set = lastUpdate(db).$set.partyPositions;
    expect(set).toHaveLength(1);
    expect(set[0].side).toBe("yes");
  });

  it("rejects declaring off-campaign", async () => {
    setRef(db, { _id: REF_ID, status: "polling", regionId: "NIR", partyPositions: [] });
    const r = await declarePartyPosition(db as unknown as Db, {
      referendumId: REF_ID,
      partyId: "8",
      side: "yes",
      declaredByCharacterId: CHAR,
      turn: 50,
    });
    expect(r.status).toBe(400);
  });

  it("404s a missing referendum", async () => {
    setRef(db, null);
    const r = await declarePartyPosition(db as unknown as Db, {
      referendumId: REF_ID,
      partyId: "8",
      side: "yes",
      declaredByCharacterId: CHAR,
      turn: 50,
    });
    expect(r.status).toBe(404);
  });
});

describe("withdrawPartyPosition", () => {
  it("pulls the party's entry", async () => {
    const db = createMockDb();
    db.collection("referendums").findOne.mockResolvedValue({
      _id: REF_ID,
      status: "campaigning",
      regionId: "NIR",
      partyPositions: [
        { partyId: "8", side: "yes", declaredByCharacterId: CHAR, declaredTurn: 50 },
      ],
    });
    const r = await withdrawPartyPosition(db as unknown as Db, {
      referendumId: REF_ID,
      partyId: "8",
    });
    expect(r.status).toBe(200);
    expect(r.body.positions).toEqual([]);
  });
});
