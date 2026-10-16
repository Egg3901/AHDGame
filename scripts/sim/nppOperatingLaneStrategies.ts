/** Operating-lane and paid-capacity invariants for NPP retool decisions. */
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import type { CorporateSector, SectorBuildOrder } from "../../src/lib/db/types";
import type { CommodityType } from "../../src/lib/constants/commodities";
import { makeCorporation } from "../../src/lib/test-utils/factories";
import {
  getOperatingSectorType,
  SECTOR_STRATEGIES,
} from "../../src/lib/constants/sectorStrategies";
import { getStrategyAvailability } from "../../src/lib/constants/techTree/strategyAvailability";
import { revenuePerCapacityUnitForStrategy } from "../../src/lib/constants/capacityEconomy";
import { chooseNppStrategyRetool } from "../../src/lib/turn/npp/strategyRetooling";

const identities = [
  { sectorType: "media", mediaDiscriminator: undefined, industryModel: undefined },
  { sectorType: "media", mediaDiscriminator: "entertainment", industryModel: undefined },
  { sectorType: "manufacturing", mediaDiscriminator: undefined, industryModel: undefined },
  { sectorType: "manufacturing", mediaDiscriminator: undefined, industryModel: "vehicles" },
] as const;
const profiles: readonly Partial<Record<CommodityType, number>>[] = [
  { advertising: 4, entertainment_services: 0.5 },
  { steel: 8, electronics: 4, vehicles: 1.1 },
  { vehicles: 4, steel: 1, entertainment_services: 3 },
  { advertising: 1, entertainment_services: 3, software: 0.5 },
];
let scenarios = 0;
let decisions = 0;
const rows = [];
for (const currentYear of [1953, 1994, 2027])
  for (const techTreesEnabled of [false, true])
    for (const identity of identities)
      for (const prices of profiles) {
        scenarios++;
        const corporationId = new ObjectId("000000000000000000000100");
        const sector = {
          _id: new ObjectId("000000000000000000000101"),
          corporationId,
          countryId: "US",
          stateId: "NY",
          ...identity,
          strategyId: "standard",
          effectiveProfitMargin: -10,
          capitalStock: 1_000,
          otherOpexPerUnitAnchor: 8,
          buildQueue: [
            { unitsOrdered: 100, costPaidAnchor: 1_000, startTurn: 90, onlineTurn: 120 },
          ],
        } as CorporateSector;
        const corp = makeCorporation({
          _id: corporationId,
          type: identity.sectorType,
          industryModel: identity.industryModel,
          mediaDiscriminator: identity.mediaDiscriminator,
          countryId: "US",
        });
        const decision = chooseNppStrategyRetool({
          corp,
          sectors: [sector],
          divestedSectorIds: [],
          turn: 100,
          now: new Date("1994-01-01T00:00:00Z"),
          currentYear,
          techTreesEnabled,
          plantsEnabled: true,
          priceRatioOf: (commodity) => prices[commodity] ?? 1,
        });
        if (!decision) continue;
        decisions++;
        const targetId = String(decision.updates.strategyId);
        const lane = getOperatingSectorType(
          sector.sectorType,
          sector.industryModel,
          sector.mediaDiscriminator
        );
        const target = SECTOR_STRATEGIES[lane].find((s) => s.id === targetId);
        assert(target, "NPP selected a recipe outside its operating lane");
        assert(!getStrategyAvailability(corp, target, currentYear, techTreesEnabled).locked);
        const beforeRpu = revenuePerCapacityUnitForStrategy(
          sector.sectorType,
          "standard",
          1,
          sector.industryModel,
          sector.mediaDiscriminator
        );
        const afterRpu = revenuePerCapacityUnitForStrategy(
          sector.sectorType,
          targetId,
          1,
          sector.industryModel,
          sector.mediaDiscriminator
        );
        const stock = Number(decision.updates.capitalStock);
        const opex = Number(decision.updates.otherOpexPerUnitAnchor);
        assert(Math.abs(stock * afterRpu - 1_000 * beforeRpu) < 1e-6);
        assert(Math.abs(stock * opex - 8_000) < 1e-6);
        const queue = decision.updates.buildQueue as SectorBuildOrder[];
        assert.equal(queue[0].costPaidAnchor, 1_000);
        assert.equal(queue[0].onlineTurn, 120);
        assert(Math.abs(queue[0].unitsOrdered * afterRpu - 100 * beforeRpu) < 1e-6);
        assert(!("liquidCapital" in decision.updates));
        rows.push({ currentYear, techTreesEnabled, lane, targetId, paidValuePreserved: true });
      }
assert(decisions > 0);
console.log(
  JSON.stringify(
    {
      passed: true,
      scenarios,
      decisions,
      limitation:
        "Actual decision and capacity-rescale rules under synthetic prices. Not a dynamic world trajectory, profit forecast, or migration qualification for existing invalid records.",
      rows,
    },
    null,
    2
  )
);
