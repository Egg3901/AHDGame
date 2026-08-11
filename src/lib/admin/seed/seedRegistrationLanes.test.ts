import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { seedRegistrationLanes } from "./seedRegistrationLanes";

describe("seedRegistrationLanes 1953", () => {
  it("writes all four countries and removes pools outside the constitutional bundle", async () => {
    const db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: async () => [
        { countryId: "US", abbreviation: "DEM", sequentialId: 1 },
        { countryId: "US", abbreviation: "REP", sequentialId: 2 },
        { countryId: "UK", abbreviation: "LAB", sequentialId: 1 },
        { countryId: "UK", abbreviation: "CON", sequentialId: 2 },
        { countryId: "UK", abbreviation: "LIB", sequentialId: 11 },
        { countryId: "UK", abbreviation: "SNP", sequentialId: 4 },
        { countryId: "UK", abbreviation: "PC", sequentialId: 5 },
        { countryId: "UK", abbreviation: "SF", sequentialId: 9 },
        { countryId: "RU", abbreviation: "CPSU", sequentialId: 1 },
        { countryId: "DD", abbreviation: "SED", sequentialId: 1 },
        { countryId: "DD", abbreviation: "CDU", sequentialId: 2 },
        { countryId: "DD", abbreviation: "LDPD", sequentialId: 3 },
        { countryId: "DD", abbreviation: "NDPD", sequentialId: 4 },
        { countryId: "DD", abbreviation: "DBD", sequentialId: 5 },
      ],
    } as never);

    const result = await seedRegistrationLanes(db as unknown as Db, "1953-default");

    expect(result.rowsProcessed).toBe(80);
    expect(result.poolRowsUpserted).toBe(80);
    expect(result.warnings).toEqual([]);
    expect(db.collectionMocks.stateRegistrationPool!.updateOne).toHaveBeenCalledTimes(80);
    expect(db.collectionMocks.stateRegistrationPool!.deleteMany).toHaveBeenCalledWith({
      countryId: { $in: ["US", "UK", "RU", "DD"] },
      _id: { $nin: expect.not.arrayContaining(["US_DC", "US_AK", "US_HI"]) },
    });
  });
});
