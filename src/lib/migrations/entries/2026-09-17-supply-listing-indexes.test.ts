import { expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-17-supply-listing-indexes";
it("does not write in dry run and creates only indexes when applied", async () => {
  const db = createMockDb();
  await migration.execute(db as unknown as Db, { dryRun: true, log: () => {} });
  expect(db.collectionMocks.supplyListings).toBeUndefined();
  await migration.execute(db as unknown as Db, { dryRun: false, log: () => {} });
  expect(db.collectionMocks.supplyListings.createIndex).toHaveBeenCalledTimes(3);
  expect(db.collectionMocks.supplyAgreements).toBeUndefined();
});
