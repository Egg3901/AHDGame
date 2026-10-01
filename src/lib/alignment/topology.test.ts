import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadAlignmentTopology } from "./topology";

describe("loadAlignmentTopology", () => {
  it("orders custom poles by founding turn and id, independent of Mongo row order", async () => {
    const db = createMockDb();
    db.collection("customInternationalOrganizations").find.mockReturnValue({
      project: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue([
          {
            id: "later",
            name: "Later Bloc",
            shortName: "LB",
            creatorCountryId: "BR",
            category: "bloc",
            createdOnTurn: 12,
            alignment: { poleId: "ORG:later", accentToken: "warning" },
          },
          {
            id: "first",
            name: "First Bloc",
            shortName: "FB",
            creatorCountryId: "DE",
            category: "bloc",
            createdOnTurn: 8,
            alignment: { poleId: "ORG:first", accentToken: "info" },
          },
        ]),
      })),
    });

    const topology = await loadAlignmentTopology(db as unknown as Db, 1979);
    expect(topology.poles).toEqual(["WEST", "EAST", "ORG:first", "ORG:later"]);
  });
});
