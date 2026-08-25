/**
 * Cross-state extraction opportunity finder (#3002 sibling / Track 2 signpost).
 *
 * A capacity-bound extraction sector is limited by the deposits in ITS OWN
 * state — output above the state's per-resource capacity is clamped. Globally
 * the resource may be abundant (idle deposits sit unmined in other states), so
 * the honest fix is to point the player at where the resource actually has room
 * to grow, rather than silently relaxing the (correct) local clamp.
 *
 * This is a READ-ONLY guidance query: for each binding resource, rank other
 * states by free headroom (capacity − total desired output across that state's
 * extraction sectors). No economy state is written or changed.
 */
import type { Db } from "mongodb";
import type { CorporateSector, GameConfig } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { extractionDesiredUnits } from "@/lib/extraction/capacityHaircut";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { getExtractionOutputScaleEnabled } from "@/lib/market/featureFlag";

export interface OpportunityState {
  stateId: string;
  countryId: string;
  capacity: number;
  desired: number;
  headroom: number;
}

export interface ResourceOpportunity {
  resource: ExtractableResource;
  states: OpportunityState[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * For each of `resources`, return up to `limit` other states (excluding
 * `excludeStateId`) with the most free capacity for that resource. Desired
 * output per state uses the same ledger-unit formula as the capacity clamp.
 */
export async function computeResourceOpportunities(
  db: Db,
  resources: ExtractableResource[],
  excludeStateId: string,
  limit = 3
): Promise<ResourceOpportunity[]> {
  if (resources.length === 0) return [];

  const [capDocs, extractionSectors, states, eraUnitScale, gameConfig] = await Promise.all([
    db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .find({}, { projection: { stateId: 1, resources: 1 } })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ sectorType: "extraction" }, { projection: { stateId: 1, revenue: 1, strategyId: 1 } })
      .toArray(),
    db
      .collection<{ _id: string; countryId: string }>("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray(),
    loadWorldEraUnitScale(db),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { extractionOutputScaleEnabled: 1 } }),
  ]);
  const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled(gameConfig);

  const countryByState = new Map(states.map((s) => [s._id, s.countryId]));

  // desired[stateId][resource] — total unconstrained revenue-based output that
  // every extraction sector in the state wants on the supply ledger's unit basis.
  const desiredByState = new Map<string, Partial<Record<ExtractableResource, number>>>();
  for (const sector of extractionSectors) {
    const strat =
      SECTOR_STRATEGIES["extraction"]?.find((st) => st.id === (sector.strategyId ?? "standard")) ??
      SECTOR_STRATEGIES["extraction"]?.[0];
    const supplyRates = (strat?.supply ?? {}) as Partial<Record<string, number>>;
    const forState = desiredByState.get(sector.stateId) ?? {};
    for (const resource of EXTRACTABLE_RESOURCES) {
      const rate = supplyRates[resource] ?? 0;
      if (rate <= 0) continue;
      const output = extractionDesiredUnits(
        sector.revenue,
        rate,
        resource,
        eraUnitScale,
        extractionOutputScaleEnabled
      );
      forState[resource] = (forState[resource] ?? 0) + output;
    }
    desiredByState.set(sector.stateId, forState);
  }

  const result: ResourceOpportunity[] = [];
  for (const resource of resources) {
    const opportunities: OpportunityState[] = [];
    for (const capDoc of capDocs) {
      if (capDoc.stateId === excludeStateId) continue;
      const capacity = capDoc.resources?.[resource] ?? 0;
      if (capacity <= 0) continue;
      const countryId = countryByState.get(capDoc.stateId);
      if (!countryId) continue;
      const desired = desiredByState.get(capDoc.stateId)?.[resource] ?? 0;
      const headroom = capacity - desired;
      if (headroom <= 0) continue;
      opportunities.push({
        stateId: capDoc.stateId,
        countryId,
        capacity: round2(capacity),
        desired: round2(desired),
        headroom: round2(headroom),
      });
    }
    if (opportunities.length === 0) continue;
    opportunities.sort((a, b) => b.headroom - a.headroom);
    result.push({ resource, states: opportunities.slice(0, limit) });
  }
  return result;
}
