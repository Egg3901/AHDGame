import type { Db } from "mongodb";
import type { EnergyPlant } from "@/lib/db/types/energyPlant";
import type { CountryId } from "@/lib/constants/countries";
import {
  aggregateMix,
  ENERGY_EFFECT,
  ENERGY_UPKEEP_UNIT,
  resolveEnergyPosition,
  type MixAggregate,
} from "@/lib/constants/cabinetEnergy";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { resolveEnergyEnvelope } from "./energyEnvelope";
import { loadPoliticalMacroInputs } from "@/lib/politicalLegislation/politicalMacroInputs";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";
import { resolveGameYear } from "@/lib/era/era";
import type { GameState } from "@/lib/db/types";

const CAP = 0.08; // matches MAX_PER_METRIC_MODIFIER_PER_TURN; the pipeline re-clamps too.
const clampCap = (v: number) => Math.max(-CAP, Math.min(CAP, v));

/** Region grid reliability target (0-100): firm capacity share + source diversity. */
export function reliabilityScore(mix: MixAggregate): number {
  if (mix.totalCapacity <= 0) return 0;
  const distinct = Object.values(mix.bySource).filter((c) => c > 0).length;
  const diversity = Math.min(1, distinct / 4); // 4+ sources = full diversity credit
  return Math.round(100 * (0.7 * mix.firmShare + 0.3 * diversity));
}

/**
 * Pure: nudge a region's energy metrics toward its mix-implied targets.
 *
 * UNITS. `current.reliability` arrives in the metric's OWN unit — grid uptime
 * percent, which sits in a realistic 97-99.9 band — while `reliabilityScore`
 * returns a 0-100 QUALITY score. Differencing them directly compared a score of
 * 70 against an uptime of 99, so the gap was hugely negative for every mix on
 * earth, the result pinned to the -CAP clamp every single turn, and an energy
 * estate could only ever DAMAGE its own grid. `relTarget` is converted into the
 * metric's own unit first, so a good mix raises reliability and a bad one
 * lowers it, which is the whole point of the mechanic.
 */
export function computeRegionEnergyDeltas(
  regionPlants: EnergyPlant[],
  current: { renewable: number; carbon: number; reliability: number },
  /** Opt-in era: convert the reliability target against that year's band. */
  era?: { countryId?: string | null; year?: number | null }
): Record<string, number> {
  if (regionPlants.length === 0) return {};
  const mix = aggregateMix(regionPlants);
  if (mix.totalCapacity <= 0) return {};
  const renewTarget = mix.renewableShare * 100;
  const carbonTarget = mix.carbonIntensity * ENERGY_EFFECT.carbonTargetMax;
  const relTarget =
    legacyValueFromPoliticalScore(
      "infrastructure",
      "powerGridReliability",
      reliabilityScore(mix),
      era
    ) ?? current.reliability;
  return {
    "environment.renewableEnergy": clampCap(
      (renewTarget - current.renewable) * ENERGY_EFFECT.renewableWeight
    ),
    "environment.carbonEmissions": clampCap(
      (carbonTarget - current.carbon) * ENERGY_EFFECT.carbonWeight
    ),
    "infrastructure.powerGridReliability": clampCap(
      (relTarget - current.reliability) * ENERGY_EFFECT.reliabilityWeight
    ),
  };
}

/**
 * Turn step for one (country, energy seat): per-region plant mixes nudge that
 * region's energy metrics toward their mix targets (→ bucket.regional), and total
 * fleet upkeep vs the energy envelope tilts national budgetBalance. Read-only budget.
 *
 * SP4/SP5 note, SUPERSEDED for this step by the step-6 cutover — kept because
 * it still describes the SIBLING cabinet steps. The problem was that the
 * regional `stateMetrics` read has no doc to find for a country whose political
 * half was stripped, so `current` baselined at 0 and the nudges were computed
 * against a value that did not exist. It was inert only because
 * `ministerialOrderProcessing` drops those demolished paths before the bulk
 * write.
 *
 * This step now resolves `current` from the political board for any board
 * country, so the baseline is real rather than 0. The same broken read shape
 * still exists in the sibling estate / infra / military cabinet steps, and the
 * original note's advice holds for them: the store contract belongs in one
 * shared guard, not four one-off early returns.
 */
export async function applyEnergyEffects(
  db: Db,
  countryId: string,
  positionId: string,
  bucket: { national: Record<string, number>; regional: Record<string, Record<string, number>> }
): Promise<void> {
  if (!resolveEnergyPosition(countryId, positionId)) return;
  const mechanics = getCabinetMechanics(countryId, positionId);
  if (!mechanics) return;

  const col = getEnergyPlantsCollection(db);
  const plants = await col.find({ countryId: countryId as CountryId, positionId }).toArray();
  if (plants.length === 0) return;

  const metrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];

  // Group plants by region, read current regional metrics, nudge toward mix targets.
  const byRegion = new Map<string, EnergyPlant[]>();
  for (const p of plants) {
    const arr = byRegion.get(p.regionId) ?? [];
    arr.push(p);
    byRegion.set(p.regionId, arr);
  }
  // Board countries resolve their CURRENT energy levels from the political
  // board instead of the legacy doc. All three paths have ADAPTER_TIER1 rows.
  // `legacyValue`, not `legacyUnit`: the deltas below are computed against real
  // legacy units (renewable %, tCO2/capita, grid reliability 97-99.9), and only
  // powerGridReliability has an authored Bridge A band — the other two would
  // come back null and silently pin `current` to 0.
  const political = await loadPoliticalMacroInputs(db);
  // Era-aware only while the era system is on, matching the dynamics phase: a
  // realistic 1953 grid never clears the modern band, so scoring it there reads
  // every early-Cold-War region as bottom-of-scale.
  const eraGameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" as GameState["_id"] },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, eraSystemEnabled: 1 } }
    );
  const era = {
    countryId,
    year: eraGameState?.eraSystemEnabled ? (resolveGameYear(eraGameState) ?? null) : null,
  };

  for (const [regionId, regionPlants] of byRegion) {
    // A region with no board reads all three as 0, which is what the legacy
    // branch removed here had already been returning: the store it queried has
    // been empty since every region gained a board.
    const fromBoard = (path: string) =>
      political.has(regionId) ? (political.legacyValue(regionId, path) ?? 0) : 0;
    const current = {
      renewable: fromBoard("environment.renewableEnergy"),
      carbon: fromBoard("environment.carbonEmissions"),
      reliability: fromBoard("infrastructure.powerGridReliability"),
    };
    const deltas = computeRegionEnergyDeltas(regionPlants, current, era);
    for (const [rawPath, v] of Object.entries(deltas)) {
      if (!v) continue;
      const path = resolveMetricPath(rawPath, metrics);
      (bucket.regional[regionId] ??= {})[path] = (bucket.regional[regionId][path] ?? 0) + v;
    }
  }

  // National budget tilt — fleet upkeep (millions) vs envelope (absolute → millions).
  const agg = aggregateMix(plants);
  const envelopeM = (await resolveEnergyEnvelope(db, countryId)) / ENERGY_UPKEEP_UNIT;
  if (envelopeM > 0) {
    const gap = Math.max(-1, Math.min(1, (envelopeM - agg.totalUpkeep) / envelopeM));
    const bpath = resolveMetricPath("governance.budgetBalance", metrics);
    bucket.national[bpath] =
      (bucket.national[bpath] ?? 0) + +(gap * ENERGY_EFFECT.budgetWeight).toFixed(4);
  }
}
