import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision } from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import { groupOperator } from "@/lib/corporations/groups/operator";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { GroupDirection } from "@/lib/corporations/groups/managementTypes";

const ceoId = new ObjectId();
const corp = {
  _id: new ObjectId(),
  countryId: "US",
  type: "construction",
  secondaryType: "manufacturing",
  headquartersState: "CA",
  liquidCapital: 500_000_000,
  ceoType: "npp",
  ceoId,
} as Corporation;
const sector = {
  _id: new ObjectId(),
  sectorType: "construction",
  countryId: "US",
  stateId: "CA",
  revenue: 10_000_000,
  realizedRevenue: 10_000_000,
  profitMargin: 30,
  effectiveProfitMargin: 30,
  targetGrowthRate: 2,
} as CorporateSector;
const pools = new Map<string, UnownedSector[]>([
  [
    "US",
    [
      {
        _id: new ObjectId(),
        stateId: "NV",
        countryId: "US",
        sectorType: "manufacturing",
        revenue: 40_000_000,
        headroomUnits: 10000,
      },
      {
        _id: new ObjectId(),
        stateId: "NV",
        countryId: "US",
        sectorType: "construction",
        revenue: 40_000_000,
        headroomUnits: 10000,
      },
    ] as UnownedSector[],
  ],
]);
const direction: GroupDirection = {
  revision: "revision",
  rootId: "root",
  ceoId: ceoId.toString(),
  ceoTenureKey: groupOperator(corp, "root").ceoTenureKey,
  objective: "expansion",
  regions: [],
  allowInvestment: true,
  primaryIndustryOnly: true,
  setTurn: 99,
  response: "pending",
};

function decide(d: GroupDirection | undefined, sectors = [sector], plants = true) {
  return makeNppCorpDecision(
    {
      corp,
      sectors,
      turn: 100,
      now: new Date("2026-01-01"),
      modifiers: ceoArchetypeModifiers("cautious"),
      groupDirection: d,
      groupRootId: "root",
      ordinaryEntryEligible: true,
      shortageEntryEligible: true,
    },
    pools,
    new Set(),
    (commodity) => (commodity === "steel" || commodity === "building_materials" ? 20 : 1),
    plants
      ? {
          enabled: true,
          eraUnitScale: 1,
          year: 2019,
          preset: "2019-default",
          primeRateOf: () => 0,
          costOfLivingOf: () => null,
        }
      : undefined
  );
}

describe("group primary-industry mandate in real NPP decisions", () => {
  it("selects primary construction even when secondary manufacturing has a critical shortage", () => {
    const result = decide(direction);
    expect(result.newSectors).toHaveLength(1);
    expect(result.newSectors?.[0].sectorType).toBe("construction");
  });
  it("preserves diversification for omitted, disabled, same-turn and stale mandates", () => {
    for (const d of [
      undefined,
      { ...direction, primaryIndustryOnly: false },
      { ...direction, setTurn: 100 },
      { ...direction, rootId: "former-root" },
      { ...direction, ceoTenureKey: "former-tenure" },
    ]) {
      expect(decide(d).newSectors?.[0].sectorType).toBe("manufacturing");
    }
  });
  it("intersects region and industry restrictions rather than relaxing either", () => {
    expect(decide({ ...direction, regions: ["CA"] }).newSectors ?? []).toHaveLength(0);
  });
  it("blocks new off-industry reinvestment without deleting the existing sector", () => {
    const off = {
      ...sector,
      _id: new ObjectId(),
      sectorType: "manufacturing",
      capitalStock: 100,
      producedUnits: 100,
      soldUnits: 100,
    } as CorporateSector;
    const result = decide(direction, [sector, off]);
    expect(result.divestedSectorIds ?? []).not.toContainEqual(off._id);
    expect(result.reinvestments?.some((r) => r.sectorId.equals(off._id)) ?? false).toBe(false);
  });
  it("zeroes an existing legacy off-industry growth target", () => {
    const off = {
      ...sector,
      _id: new ObjectId(),
      sectorType: "manufacturing",
      targetGrowthRate: 5,
    } as CorporateSector;
    const result = decide(direction, [sector, off], false);
    expect(result.sectorUpdates).toContainEqual(
      expect.objectContaining({
        filter: { _id: off._id },
        update: { $set: { targetGrowthRate: 0, updatedAt: new Date("2026-01-01") } },
      })
    );
  });
});
