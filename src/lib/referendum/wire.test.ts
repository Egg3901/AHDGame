import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { recordWireEvent, listReferendumWire } from "./wire";

const REF = new ObjectId();

function cursor<T>(docs: T[]) {
  const c = {
    sort: vi.fn(() => c),
    skip: vi.fn(() => c),
    limit: vi.fn(() => c),
    toArray: vi.fn().mockResolvedValue(docs),
  };
  return c;
}

describe("recordWireEvent", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("inserts a wire event with a stamped timestamp", async () => {
    db.collectionMocks["referendumWire"] = db.collection("referendumWire");
    await recordWireEvent(
      db as unknown as Db,
      {
        referendumId: REF,
        countryId: "UK",
        regionId: "NIR",
        turn: 140,
        kind: "opened",
        summary: "Campaign opened.",
      },
      new Date(0)
    );
    const doc = db.collectionMocks["referendumWire"].insertOne.mock.calls[0][0];
    expect(doc.kind).toBe("opened");
    expect(doc.at).toEqual(new Date(0));
  });
});

describe("listReferendumWire", () => {
  it("paginates newest-first and clamps out-of-range pages", async () => {
    const db = createMockDb();
    db.collectionMocks["referendumWire"] = db.collection("referendumWire");
    db.collectionMocks["referendumWire"].countDocuments.mockResolvedValue(25);
    db.collectionMocks["referendumWire"].find.mockReturnValue(cursor([{ kind: "opened" }]));
    const page = await listReferendumWire(db as unknown as Db, REF, 99, 10);
    expect(page.total).toBe(25);
    expect(page.totalPages).toBe(3);
    expect(page.page).toBe(3); // clamped from 99
    const c = db.collectionMocks["referendumWire"].find.mock.results[0].value;
    expect(c.skip).toHaveBeenCalledWith(20);
    expect(c.limit).toHaveBeenCalledWith(10);
  });
});
