/**
 * crisisIntake — bounded database shell for portable NPP agenda crisis rules.
 * The projection contains only the fields needed for country scope, start time,
 * metric-domain mapping, and current effect/rung change detection.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Crisis, CrisisEffect } from "@/lib/db/types/crisis";
import { METRIC_TO_DOMAIN } from "@/lib/nppAutonomy/selectNppBill";
import {
  crisisAgendaSignalsFromCrises,
  crisisSignalsFromEffects as mapCrisisSignalsFromEffects,
  type MetricDomainMap,
  type CrisisAgendaIntake,
} from "./rules/crisisAgendaSignals";

export type { CrisisAgendaIntake };

/** Preserve the existing convenience API while the rules accept their vocabulary as data. */
export function crisisSignalsFromEffects(
  effects: readonly CrisisEffect[],
  metricToDomain: MetricDomainMap = METRIC_TO_DOMAIN
): Record<string, number> {
  return mapCrisisSignalsFromEffects(effects, metricToDomain);
}

/** Load the active crisis subset once and pass plain data into the rules core. */
export async function loadCrisisAgendaSignals(
  db: Db,
  countryId: CountryId
): Promise<CrisisAgendaIntake> {
  const crises = await db
    .collection<Crisis>("crises")
    .find(
      { status: "active", $or: [{ countryIds: countryId }, { scope: "global" }] },
      {
        projection: {
          status: 1,
          scope: 1,
          countryIds: 1,
          startTurn: 1,
          effects: 1,
          "chain.family": 1,
          "chain.rung": 1,
        },
      }
    )
    .toArray();

  return crisisAgendaSignalsFromCrises(crises, countryId, METRIC_TO_DOMAIN);
}
