import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { planLiveFederationStateTransfers } from "./territoryTransferPlan";

describe("live federation state transfer plan", () => {
  it("assigns nested districts with their parent and keeps continuing territory detailed", async () => {
    const mem = createInMemoryDb();
    mem.seed("states", [
      { _id: "RUSSIA", countryId: "RU", population: 10, gdp: 100 },
      { _id: "UKRAINE", countryId: "RU", population: 11, gdp: 101 },
      {
        _id: "KYIV",
        parentRegionId: "UKRAINE",
        countryId: "RU",
        population: 2,
        gdp: 20,
      },
    ]);
    const args = {
      db: mem as unknown as Db,
      sourceCountryId: "RU" as const,
      territories: [
        { entityId: "RU", regionIds: ["RUSSIA"], population: 10, annualGdpAnchor: 100 },
        { entityId: "UKR", regionIds: ["UKRAINE"], population: 11, annualGdpAnchor: 101 },
      ],
    };
    expect(await planLiveFederationStateTransfers(args)).toEqual([
      {
        stateId: "KYIV",
        parentRegionId: "UKRAINE",
        topLevelRegionId: "UKRAINE",
        successorEntityId: "UKR",
        leavesDetailedSource: true,
      },
      {
        stateId: "RUSSIA",
        parentRegionId: null,
        topLevelRegionId: "RUSSIA",
        successorEntityId: "RU",
        leavesDetailedSource: false,
      },
      {
        stateId: "UKRAINE",
        parentRegionId: null,
        topLevelRegionId: "UKRAINE",
        successorEntityId: "UKR",
        leavesDetailedSource: true,
      },
    ]);
    await expect(
      planLiveFederationStateTransfers({ ...args, territories: args.territories.slice(0, 1) })
    ).rejects.toThrow("does not cover every live top-level region");
  });
});
