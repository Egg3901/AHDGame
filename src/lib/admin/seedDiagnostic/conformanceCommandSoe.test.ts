import { ObjectId, type Db } from "mongodb";
import { expect, it } from "vitest";
import { checkSectors } from "./conformance";
import { buildSeedExpectations } from "./expectations";

const huOwner = new ObjectId("7000000000000000000000a1");
const ruOwner = new ObjectId("7000000000000000000000a2");

function fixture(missingRuSoe = false): Db {
  const unowned = [{ countryId: "HU", sectorType: "extraction", revenue: 1 }];
  const owners = [
    { _id: huOwner, countryOwnerId: "HU" },
    ...(!missingRuSoe ? [{ _id: ruOwner, countryOwnerId: "RU" }] : []),
  ];
  const owned = [
    { countryId: "HU", corporationId: huOwner, sectorType: "manufacturing", revenue: 59 },
    { countryId: "HU", corporationId: huOwner, sectorType: "agriculture", revenue: 40 },
    ...(!missingRuSoe
      ? [
          { countryId: "RU", corporationId: ruOwner, sectorType: "manufacturing", revenue: 60 },
          { countryId: "RU", corporationId: ruOwner, sectorType: "agriculture", revenue: 40 },
        ]
      : []),
  ];
  const rows = (name: string, filter: Record<string, unknown>) => {
    const source =
      name === "unownedSectors"
        ? unowned
        : name === "corporations"
          ? owners
          : name === "corporateSectors"
            ? owned
            : [];
    return source.filter((row) => {
      if ("countryId" in filter && !("countryId" in row && row.countryId === filter.countryId))
        return false;
      if (
        "countryOwnerId" in filter &&
        !("countryOwnerId" in row && row.countryOwnerId === filter.countryOwnerId)
      )
        return false;
      if ("corporationId" in filter) {
        const ids = (filter.corporationId as { $in: ObjectId[] }).$in;
        return (
          "corporationId" in row &&
          row.corporationId instanceof ObjectId &&
          ids.some((id) => id.equals(row.corporationId))
        );
      }
      return true;
    });
  };
  return {
    collection: (name: string) => ({
      findOne: async () => (name === "gameConfig" ? { commandEconomyEnabled: true } : null),
      countDocuments: async (filter: Record<string, unknown>) =>
        name === "strategicSectorDesignations" ? 99 : rows(name, filter).length,
      find: (filter: Record<string, unknown>) => ({
        toArray: async () => rows(name, filter),
        project: () => ({ toArray: async () => rows(name, filter) }),
      }),
    }),
  } as unknown as Db;
}

it("checks command-era 1953 production in owned SOEs and retains strict market checks", async () => {
  const checks = await checkSectors(fixture(), buildSeedExpectations("1953-default"));
  for (const id of [
    "sectors.HU.weightDist",
    "sectors.RU.weightDist",
    "sectors.RU.unowned",
    "sectors.HU.commandSoe",
    "sectors.RU.commandSoe",
  ]) {
    expect(checks.find((check) => check.id === id)?.severity, id).toBe("ok");
  }
  expect(checks.find((check) => check.id === "sectors.US.unowned")?.severity).toBe("critical");
});

it("still rejects a command-era seed without producing country-owned SOEs", async () => {
  const checks = await checkSectors(fixture(true), buildSeedExpectations("1953-default"));
  expect(checks.find((check) => check.id === "sectors.RU.commandSoe")?.severity).toBe("critical");
});
