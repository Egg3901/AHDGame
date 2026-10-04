import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { CorporateSector, State } from "@/lib/db/types";
import { normalizeAndMergeCorporateSectors } from "./repairDuplicateSectors";

describe("normalizeAndMergeCorporateSectors secured rows", () => {
  it("does not merge or delete a duplicate group containing an active construction pledge", async () => {
    const db = createMockDb();
    const corporationId = new ObjectId();
    const makeSector = (constructionFinancing?: CorporateSector["constructionFinancing"]) =>
      ({
        _id: new ObjectId(),
        corporationId,
        countryId: "US",
        stateId: "TX",
        sectorType: "energy",
        revenue: 100,
        workers: 20,
        profitMargin: 10,
        constructionFinancing,
      }) as CorporateSector;
    const pledged = makeSector({
      status: "building",
      escrowLocal: 0,
    } as CorporateSector["constructionFinancing"]);
    const unpledged = makeSector();
    db.collection("corporateSectors");
    db.collection("states");
    const sectorCursor = {
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([unpledged, pledged]),
    };
    db.collectionMocks.corporateSectors.find.mockReturnValue(sectorCursor);
    db.collectionMocks.states.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "TX", countryId: "US" } satisfies Pick<State, "_id" | "countryId">,
        ]),
    });

    const result = await normalizeAndMergeCorporateSectors(db as unknown as Db);

    expect(result.mergedGroups).toEqual([]);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.deleteMany).not.toHaveBeenCalled();
  });
});
