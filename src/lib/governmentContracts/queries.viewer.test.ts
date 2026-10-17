import { it, expect, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
const ids = vi.hoisted(() => vi.fn());
vi.mock("./viewerOpportunities", () => ({ viewerTenderIds: ids }));
import { listGovernmentTenders } from "./queries";
it("applies viewer matching before counting and paging and never reads sealed bids for matching", async () => {
  const db = createMockDb();
  db.collection("governmentTenders");
  const c = db.collectionMocks.governmentTenders;
  c.find().toArray.mockResolvedValue([]);
  c.countDocuments.mockResolvedValue(11);
  ids.mockResolvedValue(["matching"]);
  c.find.mockClear();
  const result = await listGovernmentTenders(db as unknown as Db, "US", "active", undefined, 2, 5, {
    userId: "a".repeat(24),
  });
  expect(ids).toHaveBeenCalledWith(db, "US", [], 5, "a".repeat(24), undefined);
  expect(c.find.mock.calls[0][1]).toEqual({ projection: { _id: 1, terms: 1, publishedTurn: 1 } });
  expect(c.countDocuments.mock.calls[0][0]).toMatchObject({
    _id: { $in: ["matching"] },
    countryId: "US",
  });
  expect(c.find.mock.calls[1][0]).toMatchObject({ _id: { $in: ["matching"] } });
  expect(c.find().skip).toHaveBeenCalledWith(10);
  expect(result).toMatchObject({ total: 11, totalPages: 2, page: 2, pageSize: 10 });
});
