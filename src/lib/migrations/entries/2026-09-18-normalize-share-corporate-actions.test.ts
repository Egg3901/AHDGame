import { describe, expect, it } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-18-normalize-share-corporate-actions";

describe("2026-09-18-normalize-share-corporate-actions", () => {
  it("normalizes stale corporate-action rows", async () => {
    const db = createMockDb();
    const collection = db.collection("shareTradeHistory");
    collection.updateMany.mockResolvedValue({ matchedCount: 32, modifiedCount: 32 });

    const result = await migration.execute(db as never, { dryRun: false });

    expect(collection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ kind: { $in: ["stock_split", "reverse_split"] } }),
      { $set: { shares: 0, pricePerShareAnchor: 0, totalAnchor: 0 } }
    );
    expect(result.documentsUpdated).toBe(32);
  });

  it("does not write during a dry run", async () => {
    const db = createMockDb();
    const collection = db.collection("shareTradeHistory");
    collection.countDocuments.mockResolvedValue(4);

    const result = await migration.execute(db as never, { dryRun: true });

    expect(collection.countDocuments).toHaveBeenCalledTimes(1);
    expect(collection.updateMany).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });
});
