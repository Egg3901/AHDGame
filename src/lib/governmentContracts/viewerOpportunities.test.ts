import { it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { viewerTenderIds } from "./viewerOpportunities";
import type { GovernmentTender } from "./types";
it("loads only corporations controlled by the viewer, projects inputs and matches the concession state", async () => {
  const db = createMockDb();
  db.collection("corporations");
  db.collection("corporateSectors");
  const corp = new ObjectId(),
    user = new ObjectId();
  db.collectionMocks.corporations
    .find()
    .toArray.mockResolvedValue([{ _id: corp, type: "extraction", countryId: "US", userId: user }]);
  db.collectionMocks.corporateSectors
    .find()
    .toArray.mockResolvedValue([
      { _id: new ObjectId(), corporationId: corp, stateId: "TX", sectorType: "extraction" },
    ]);
  const row = (id: string, stateId: string) =>
    ({
      _id: id,
      terms: { type: "extraction", stateId, minimumSigningFeeAnchor: 500 },
      publishedTurn: 1,
    }) as GovernmentTender;
  expect(
    await viewerTenderIds(
      db as unknown as Db,
      "US",
      [row("yes", "TX"), row("no", "MN")],
      5,
      user.toHexString(),
      corp.toHexString()
    )
  ).toEqual(["yes"]);
  expect(db.collectionMocks.corporations.find.mock.calls.at(-1)?.[0]).toEqual({
    userId: user,
    ceoVacant: { $ne: true },
    _id: corp,
  });
  expect(db.collectionMocks.corporateSectors.find.mock.calls.at(-1)?.[0]).toEqual({
    corporationId: { $in: [corp] },
  });
  expect(Object.keys(db.collectionMocks)).toEqual(["corporations", "corporateSectors"]);
});
