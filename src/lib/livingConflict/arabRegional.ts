import type { Db } from "mongodb";
import type { MacroCountryState } from "@/lib/world/macro/types";
import type { LivingConflictState } from "./types";
import { ARAB_HOSTS, advanceArabRegion, arabExtremistSpillover } from "./rules/arabRegional";
import {
  ARAB_ORIGINS,
  ARAB_UPRISINGS_KEY,
  boundedArab,
  type ArabOriginSignal,
} from "./rules/arabOrigins";
import { projectArabRegion } from "./rules/arabProjection";

/** Four bounded, projected batch reads, only at initialization or quarterly
 * pressure ticks. Background stability is explicitly an estimate of legitimacy;
 * no unemployment or demographic observation is fabricated when absent. */
export async function advanceArabRegionalTurn(
  db: Db,
  state: LivingConflictState,
  turn: number
): Promise<LivingConflictState> {
  if (state.defKey !== ARAB_UPRISINGS_KEY || !state.hasOpened || state.status === "closed")
    return state;
  if (state.arabRegional && (turn % 12 !== 0 || state.arabRegional.lastPressureTurn === turn))
    return projectArabRegion(state);
  const ids = [...ARAB_ORIGINS, ...ARAB_HOSTS];
  const [background, regions, approvals, metrics] = await Promise.all([
    db
      .collection<MacroCountryState>("macroCountries")
      .find(
        { entityId: { $in: ids }, retiredAt: null },
        {
          projection: {
            entityId: 1,
            population: 1,
            stability: 1,
            "contribution.byCommodity.food": 1,
          },
        }
      )
      .toArray(),
    db
      .collection<{ _id: string; countryId: string; population: number }>("states")
      .find({ countryId: { $in: ids } }, { projection: { _id: 1, countryId: 1, population: 1 } })
      .toArray(),
    db
      .collection<{ _id: string; approvalRating: number }>("governmentApprovals")
      .find({ _id: { $in: [...ARAB_ORIGINS] } }, { projection: { _id: 1, approvalRating: 1 } })
      .toArray(),
    db
      .collection<{
        _id: string;
        countryId: string;
        economic?: { unemploymentRate?: { value: number }; costOfLiving?: { value: number } };
      }>("macroMetrics")
      .find(
        { countryId: { $in: [...ARAB_ORIGINS] } },
        {
          projection: {
            _id: 1,
            countryId: 1,
            "economic.unemploymentRate.value": 1,
            "economic.costOfLiving.value": 1,
          },
        }
      )
      .toArray(),
  ]);
  const populations: Record<string, number> = Object.fromEntries(
    background.map((row) => [row.entityId, row.population])
  );
  const playablePopulations: Record<string, number> = {};
  for (const region of regions)
    playablePopulations[region.countryId] =
      (playablePopulations[region.countryId] ?? 0) + Math.max(0, region.population ?? 0);
  Object.assign(populations, playablePopulations);
  const signals: ArabOriginSignal[] = [];
  for (const countryId of ARAB_ORIGINS) {
    const approval = approvals.find((row) => row._id === countryId);
    const macro = background.find((row) => row.entityId === countryId);
    if (!(populations[countryId] > 0) || (!approval && !macro)) continue;
    const local = metrics.filter((row) =>
      regions.some((region) => region._id === row._id && region.countryId === countryId)
    );
    const unemployment = local
      .map((row) => row.economic?.unemploymentRate?.value)
      .filter((value): value is number => Number.isFinite(value));
    const food = macro?.contribution?.byCommodity?.food;
    signals.push({
      countryId,
      population: populations[countryId],
      legitimacy: approval?.approvalRating ?? (macro?.stability ?? 0.5) * 100,
      foodStress: food && food.supply > 0 ? food.demand / food.supply : 1,
      ...(unemployment.length
        ? {
            unemployment: unemployment.reduce((sum, value) => sum + value, 0) / unemployment.length,
          }
        : {}),
      basis: approval ? "playable" : "background",
    });
  }
  return projectArabRegion({
    ...state,
    arabRegional: advanceArabRegion(state.arabRegional, signals, populations, turn),
  });
}

/** Exposure contributes a bounded standing threat, not another cumulative
 * attack or an invented decision by the affected governments. */
export async function reconcileArabTerrorismSpillover(
  db: Db,
  state: LivingConflictState,
  turn: number
): Promise<LivingConflictState> {
  if (state.defKey !== "transnational_terrorism" || !state.hasOpened || turn % 12 !== 0)
    return state;
  const conflict = await db
    .collection<LivingConflictState>("livingConflicts")
    .findOne(
      { defKey: ARAB_UPRISINGS_KEY },
      { projection: { hasOpened: 1, status: 1, arabRegional: 1 } }
    );
  const target = arabExtremistSpillover(conflict);
  const prior = state.tracks?.arabRegionalSpillover ?? 0;
  if (target === prior) return state;
  return {
    ...state,
    tracks: {
      ...state.tracks,
      arabRegionalSpillover: target,
      threatCapability: boundedArab((state.tracks?.threatCapability ?? 0) + target - prior),
    },
  };
}
