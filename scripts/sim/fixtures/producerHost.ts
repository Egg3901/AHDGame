/** Synthetic holdings with the implemented physical, wage and site-cost preparation. */
import { ObjectId } from "mongodb";
import {
  OPERATING_SECTOR_TYPES,
  operatingSectorIdentity,
} from "../../../src/lib/constants/corporations";
import { EXTRACTABLE_RESOURCES } from "../../../src/lib/constants/commodities";
import {
  SECTOR_STRATEGIES,
  getEffectiveStrategyRatesForOperatingModel,
} from "../../../src/lib/constants/sectorStrategies";
import { TURNS_PER_DAY } from "../../../src/lib/constants/turnTime";
import { CAPITAL_DEPRECIATION_PER_TURN } from "../../../src/lib/market/capital";
import { unitYieldForSupply } from "../../../src/lib/constants/capacityEconomy";
import {
  prepareProducerPhysicalSector,
  type ProducerPhysicalEnv,
} from "../../../src/lib/turn/corporation/producerPhysicalPreparation";
import { makeCorporation } from "../../../src/lib/test-utils/factories";
import type { CorporateSector } from "../../../src/lib/db/types";

export function makePreparedProducerRecipeFixture(preset: string) {
  let index = 0;
  return OPERATING_SECTOR_TYPES.flatMap((lane) =>
    SECTOR_STRATEGIES[lane]
      .filter(
        (strategy) =>
          strategy.minDecade == null || Number(strategy.minDecade) <= Number(preset.slice(0, 4))
      )
      .map((strategy) => {
        const identity = operatingSectorIdentity(lane);
        const id = new ObjectId((++index).toString(16).padStart(24, "0"));
        const corporation = makeCorporation({
          _id: id,
          userId: id,
          ceoId: id,
          type: identity.sectorType,
          industryModel: identity.industryModel,
          mediaDiscriminator: identity.mediaDiscriminator,
          countryId: "US",
          liquidCurrencyCode: "USD",
          createdAt: new Date(0),
          updatedAt: new Date(0),
        });
        const raw = getEffectiveStrategyRatesForOperatingModel(
          identity.sectorType,
          strategy.id,
          undefined,
          undefined,
          1,
          identity.industryModel,
          identity.mediaDiscriminator,
          preset
        );
        // Fix holdings from catalog quantities, independently of the rules under
        // test. Changing the cost basis must never enlarge this fixture's plants.
        const ownedUnitsPerSeedAnchor = unitYieldForSupply(raw.supply, 1);
        const sector: CorporateSector = {
          _id: id,
          corporationId: id,
          ...identity,
          countryId: "US",
          stateId: "fixture",
          strategyId: strategy.id,
          revenue: 0,
          profitMargin: 0,
          workers: 0,
          currentGrowthCost: 0,
          currentGrowthRate: 0,
          targetGrowthRate: 0,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          capitalStock:
            (10000 * ownedUnitsPerSeedAnchor * TURNS_PER_DAY) / (1 - CAPITAL_DEPRECIATION_PER_TURN),
          capacityBookAnchor: 10000,
          buildQueue: [],
          producerCapacity: { worldEpoch: "fixture", turn: 0 },
          producerInventory: { worldEpoch: "fixture", turn: 0, inputStock: [], outputStock: [] },
        };
        const env: ProducerPhysicalEnv = {
          currentTurn: 1,
          currentYear: Number(preset.slice(0, 4)),
          techTreesEnabled: false,
          labour: { wagesEnabled: true, unionsEnabled: false, fullEnabled: false },
          wageIndexByState: new Map(),
          automationIndexByState: new Map(),
          pendingStrikeEvents: [],
          labourDemandByState: new Map(),
          lookups: {
            preset,
            eraUnitScale: 1,
            labourTightnessByState: new Map(),
            stateResourceCapacityByState: new Map([
              [
                "fixture",
                Object.fromEntries(EXTRACTABLE_RESOURCES.map((resource) => [resource, 1])),
              ],
            ]),
            extractionCapacityUtilBySector: new Map([
              [id.toHexString(), { utilization: 1, bindingResource: null }],
            ]),
            priceRatioByCommodity: new Map(),
            activeDisasterEffectsByState: new Map(),
            rawWorkforceSkillByState: new Map(),
          },
        };
        const {
          prepared: { plan },
        } = prepareProducerPhysicalSector({
          worldEpoch: "fixture",
          env,
          corporation,
          sector,
          inputPriceHeadroom: 1.25,
        });
        // Pools keep this database-free rules fixture comparable with its earlier
        // synthetic-cost control. Holdings and unrestricted resources are synthetic.
        return {
          ...plan,
          id: `${lane}:${strategy.id}`,
          accountId: `${lane}:${strategy.id}`,
          labourRecipientAccountId: "households",
          operatingRecipientAccountId: "operating-payee",
        };
      })
  );
}
