import type { Db } from "mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type {
  Corporation,
  CorporateSector,
  FederalBudget,
  GameState,
  StateResourceCapacity,
} from "@/lib/db/types";
import type { TurnReferenceData, TurnStateProjection } from "@/lib/corporations/turnReferenceData";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import type { MacroEconomicValues, StateMetricValues } from "@/lib/constants/corporations";

export interface StateViewContext {
  states: TurnStateProjection[];
  uniqueStateIds: string[];
  stateNameMap: Map<string, string>;
  stateCountryMap: Map<string, string>;
  stateResourceCapacityByState: Map<string, StateResourceCapacity["resources"]>;
  stateMetricsMap: Map<string, StateMetricValues>;
  politicalBaseModifiersByState: Map<string, ReturnType<typeof buildPoliticalBaseModifiers>>;
  macroByCountry: Map<string, MacroEconomicValues>;
  /** Per-country investor confidence for the expropriation-risk display (spec
   * §12.4 feed 1): same source the turn reads, so display and turn stay aligned. */
  investorConfidenceByCountry: Map<string, number | undefined>;
  /** Per-country SOCI for the SOE overreach term: same source the turn reads. */
  sociByCountry: Map<string, number>;
  federalBudgets: FederalBudget[];
  gameState: GameState | null;
}

type StateMetricsDoc = Awaited<ReturnType<typeof findMergedRegionMetricsMany>>[number];

/**
 * State-scoped view context for the corporation detail view (#587).
 *
 * Loads the merged region metrics, extraction capacities, game era state,
 * political margin overlays (SP4 §4a, playable regions only among this
 * corp's states), and the federal budgets behind the macro, investor-
 * confidence, and SOCI maps.
 */
export async function loadStateViewContext(
  db: Db,
  corporation: Corporation,
  sectors: CorporateSector[],
  allStates: TurnReferenceData["allStates"]
): Promise<StateViewContext> {
  const allStateIds = [corporation.headquartersState, ...sectors.map((s) => s.stateId)];
  const uniqueStateIds = [...new Set(allStateIds)];
  const uniqueStateIdSet = new Set(uniqueStateIds);
  const [stateMetricsDocs, stateResourceCapacityDocs, gameState]: [
    StateMetricsDoc[],
    StateResourceCapacity[],
    GameState | null,
  ] =
    uniqueStateIds.length > 0
      ? await Promise.all([
          // Legacy-shaped view for the margin engine's stored reads.
          findMergedRegionMetricsMany(db, { _id: { $in: uniqueStateIds } }),
          db
            .collection<StateResourceCapacity>("stateResourceCapacity")
            .find(
              { stateId: { $in: uniqueStateIds } },
              { projection: { stateId: 1, resources: 1 } }
            )
            .toArray(),
          db.collection<GameState>("gameState").findOne(
            { _id: "current" },
            {
              projection: {
                preset: 1,
                currentYear: 1,
                currentTurn: 1,
                startingYear: 1,
                eraSystemEnabled: 1,
              },
            }
          ),
        ])
      : [[], [], null];
  const states = allStates.filter((s) => uniqueStateIdSet.has(s._id));
  // SP4 §4a: political margin overlays for playable regions among this corp's states.
  const politicalDocs: PoliticalMetricsDoc[] =
    uniqueStateIds.length > 0
      ? await db
          .collection<PoliticalMetricsDoc>("politicalMetrics")
          .find({ _id: { $in: uniqueStateIds } })
          .toArray()
      : [];
  const politicalBaseModifiersByState = new Map(
    politicalDocs.map((doc) => [String(doc._id), buildPoliticalBaseModifiers(doc.values)])
  );
  const stateNameMap = new Map(states.map((s) => [s._id, s.name]));
  const stateResourceCapacityByState = new Map(
    stateResourceCapacityDocs.map((doc) => [doc.stateId, doc.resources])
  );
  const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

  const countryIds = [...new Set(states.map((s) => s.countryId))];
  const federalBudgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      { countryId: { $in: countryIds } },
      {
        projection: {
          countryId: 1,
          "economicFactors.inflationRate": 1,
          debtToGdpRatio: 1,
          surplus: 1,
          gdp: 1,
          "taxRates.domesticCorporateTax": 1,
          "taxRates.foreignCorporateTax": 1,
        },
      }
    )
    .toArray();

  const macroByCountry = new Map<string, MacroEconomicValues>(
    federalBudgets.map((b) => [
      b.countryId,
      {
        inflationRate: b.economicFactors?.inflationRate ?? null,
        debtToGdpRatio: b.debtToGdpRatio ?? null,
        surplusToGdpRatio: b.gdp ? (b.surplus ?? 0) / b.gdp : null,
      },
    ])
  );
  // Per-country investor confidence for the expropriation-risk display (spec §12.4
  // feed 1) — same source the turn reads, so display and turn stay aligned.
  const investorConfidenceByCountry = new Map<string, number | undefined>(
    federalBudgets.map((b) => [b.countryId, b.investorConfidence])
  );
  // Per-country SOCI for the SOE overreach term — same source the turn reads.
  const sociByCountry = new Map<string, number>(
    federalBudgets.map((b) => [b.countryId, b.stateOwnershipConcentration ?? 0])
  );

  const stateMetricsMap = new Map<string, StateMetricValues>(
    stateMetricsDocs.map((sm) => [
      String(sm._id),
      {
        fullMetrics: sm,
        unemploymentRate: sm.economic?.unemploymentRate?.value ?? null,
        gridReliability: sm.infrastructure?.powerGridReliability?.value ?? null,
        corruptionIndex: sm.governance?.corruptionIndex?.value ?? null,
        workforceSkill: sm.education?.workforceSkill?.value ?? null,
        crimeRate: sm.publicSafety?.crimeRate?.value ?? null,
        broadbandAccess: sm.infrastructure?.broadbandAccess?.value ?? null,
        roadCondition: sm.infrastructure?.roadCondition?.value ?? null,
        carbonEmissions: sm.environment?.carbonEmissions?.value ?? null,
        costOfLiving: sm.economic?.costOfLiving?.value ?? null,
      },
    ])
  );

  return {
    states,
    uniqueStateIds,
    stateNameMap,
    stateCountryMap,
    stateResourceCapacityByState,
    stateMetricsMap,
    politicalBaseModifiersByState,
    macroByCountry,
    investorConfidenceByCountry,
    sociByCountry,
    federalBudgets,
    gameState,
  };
}
