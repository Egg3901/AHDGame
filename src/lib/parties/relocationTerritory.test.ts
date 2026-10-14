import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getRelocationTerritory } from "./relocationTerritory";

describe("post-relocation live presence", () => {
  it.each(["characterId", "nppId"] as const)(
    "excludes the %s and their vacated office",
    async (kind) => {
      const mock = createMockDb();
      const id = new ObjectId();
      mock.collection("states").find.mockReturnValue({
        toArray: async () => ["WA", "OR", "CA", "ID"].map((_id) => ({ _id })),
      });
      for (const collection of ["characters", "npps", "electedOfficials"]) {
        mock
          .collection(collection)
          .distinct.mockImplementation(async (_field: string, filter: Record<string, unknown>) => {
            if (collection === (kind === "characterId" ? "characters" : "npps"))
              return filter._id ? [] : ["OR"];
            if (collection === "electedOfficials") return filter[kind] ? [] : ["OR"];
            return ["WA", "CA"];
          });
      }
      const territory = await getRelocationTerritory(mock as unknown as Db, "US", "7", {
        [kind]: id,
      });
      expect([...territory.remaining].sort()).toEqual(["CA", "WA"]);
      expect(territory.canDepart).toBe(false);
      expect(territory.canMoveTo("ID")).toBe(false);
      expect(territory.canMoveTo("OR")).toBe(true);
      expect(mock.collection("electedOfficials").distinct).toHaveBeenCalledWith(
        "state",
        expect.objectContaining({ [kind]: { $ne: id } })
      );
      expect(mock.collection("states").find).toHaveBeenCalledTimes(1);
    }
  );

  it("retains a source foothold when another member remains there", async () => {
    const mock = createMockDb();
    mock.collection("states").find.mockReturnValue({
      toArray: async () => ["WA", "OR", "CA", "ID"].map((_id) => ({ _id })),
    });
    mock.collection("characters").distinct.mockResolvedValue(["WA", "OR", "CA"]);
    const territory = await getRelocationTerritory(mock as unknown as Db, "US", "7", {
      nppId: new ObjectId(),
    });
    expect(territory.canMoveTo("ID")).toBe(true);
  });
});
