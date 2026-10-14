import { expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { deleteDivestedNppSectors } from "./divestmentPersistence";

it("rechecks newly queued builds, CIP and secured claims while disposing mature unencumbered sectors", async () => {
  const memory = createInMemoryDb();
  const rows = [
    { _id: new ObjectId(), buildQueue: [{ unitsOrdered: 1 }], constructionInProgressAnchor: 0 },
    { _id: new ObjectId(), buildQueue: [], constructionInProgressAnchor: 1 },
    { _id: new ObjectId(), constructionFinancing: { status: "building", escrowLocal: 0 } },
    { _id: new ObjectId(), constructionPropertyTransition: { kind: "pending" } },
    { _id: new ObjectId() },
    { _id: new ObjectId(), buildQueue: [], constructionInProgressAnchor: 0 },
  ];
  memory.seed("corporateSectors", rows);
  expect(
    await deleteDivestedNppSectors(
      memory as unknown as Db,
      rows.map((r) => r._id)
    )
  ).toMatchObject({ deletedCount: 2 });
  const remaining = await memory.collection("corporateSectors").find({}).toArray();
  expect(remaining.map((r) => r._id)).toEqual(rows.slice(0, 4).map((r) => r._id));
});
