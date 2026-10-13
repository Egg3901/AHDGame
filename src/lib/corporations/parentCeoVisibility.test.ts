import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { parentCeoVisibleCorporationIds } from "./parentCeoVisibility";

function fixture(count = 20, shares = 80, vacant = false) {
  const db = createMockDb();
  const parent = makeCorporation({ ceoVacant: vacant });
  const children = Array.from({ length: count }, () =>
    makeCorporation({
      isPrivate: true,
      totalShares: 100,
      shareholders: [{ corporationId: parent._id, shares }],
    })
  );
  db.collection("corporations").find().toArray.mockResolvedValue([parent]);
  db.collection("corporations").find.mockClear();
  return { db, parent, children };
}

describe("batched parent CEO visibility", () => {
  it("bounds a full page to three reads and counts reserved unsold shares", async () => {
    const { db, parent, children } = fixture(20, 40);
    db.collection("shareOrders")
      .find()
      .toArray.mockResolvedValue(
        children.map((corp) => ({
          corporationId: corp._id,
          type: "sell",
          status: "open",
          placerCorporationId: parent._id,
          sharesRemaining: 20,
        }))
      );
    db.collection("shareOrders").find.mockClear();
    const visible = await parentCeoVisibleCorporationIds(
      db as unknown as Db,
      children,
      parent.userId!.toString()
    );
    expect(visible.size).toBe(20);
    expect(db.collectionMocks.shareOrders.find).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ corporationId: { $in: children.map((corp) => corp._id) } })
    );
    expect(db.collectionMocks.shareListings.find).toHaveBeenCalledOnce();
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledExactlyOnceWith({
      _id: { $in: [parent._id] },
    });
    expect(db.collectionMocks.corporations.findOne).not.toHaveBeenCalled();
  });
  it("does not grant control at 50%", async () => {
    const { db, parent, children } = fixture(20, 50);
    expect(
      await parentCeoVisibleCorporationIds(db as unknown as Db, children, parent.userId!.toString())
    ).toEqual(new Set());
    expect(db.collectionMocks.corporations.find).not.toHaveBeenCalled();
  });
  it("does not grant access for a vacant parent seat or unrelated viewer", async () => {
    const { db, parent, children } = fixture(20, 80, true);
    expect(
      await parentCeoVisibleCorporationIds(db as unknown as Db, children, parent.userId!.toString())
    ).toEqual(new Set());
    parent.ceoVacant = false;
    expect(
      await parentCeoVisibleCorporationIds(db as unknown as Db, children, new ObjectId().toString())
    ).toEqual(new Set());
  });
  it("skips all reads for anonymous viewers and empty candidates", async () => {
    const { db, children } = fixture();
    expect(await parentCeoVisibleCorporationIds(db as unknown as Db, children, null)).toEqual(
      new Set()
    );
    expect(
      await parentCeoVisibleCorporationIds(db as unknown as Db, [], new ObjectId().toString())
    ).toEqual(new Set());
    expect(db.collectionMocks.corporations.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.shareOrders).toBeUndefined();
  });
});
