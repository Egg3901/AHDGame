/**
 * crisisIntake — translate active crises into governing-agenda pressure (V1.8).
 *
 * When a crisis is damaging a country, an NPP government should drop everything
 * and respond. This maps the metric effects of active crises to agenda domains
 * (via the shared METRIC_TO_DOMAIN vocabulary) so `computeGoverningAgenda` can
 * inject dominant "raise" items — which then cascade automatically into the
 * government's ministerial orders (V1.4) and emergency bill sponsorship (V1.5),
 * since both already read the agenda.
 *
 * The effect→domain mapping is pure and unit-tested; the loader is a thin DB read.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Crisis, CrisisEffect } from "@/lib/db/types/crisis";
import { METRIC_TO_DOMAIN } from "./selectNppBill";

/** Crisis-affected domains register at full emergency severity. */
const CRISIS_DOMAIN_SEVERITY = 1;

/**
 * Map a crisis's metric effects to agenda domains. A metric-targeting effect
 * whose `metricCategory.metricField` resolves through METRIC_TO_DOMAIN marks
 * that domain as under emergency pressure. Pure and deterministic.
 */
export function crisisSignalsFromEffects(effects: CrisisEffect[]): Record<string, number> {
  const signals: Record<string, number> = {};
  for (const effect of effects) {
    if (effect.targetType !== "metric") continue;
    if (!effect.metricCategory || !effect.metricField) continue;
    const domain = METRIC_TO_DOMAIN[effect.metricCategory]?.[effect.metricField];
    if (!domain) continue;
    signals[domain] = CRISIS_DOMAIN_SEVERITY;
  }
  return signals;
}

export interface CrisisAgendaIntake {
  /** Domain → severity in [0, 1] for `computeGoverningAgenda`'s `crises` input. */
  signals: Record<string, number>;
  /** Latest start turn among the contributing crises; drives immediate recompute. */
  latestStartTurn: number;
}

/**
 * Load active-crisis agenda pressure for a country. Includes country-scoped and
 * region-scoped crises naming the country, plus global crises. Returns the
 * merged domain signals and the most recent crisis start turn (so a brand-new
 * crisis can force an agenda recompute even when the agenda is otherwise fresh).
 */
export async function loadCrisisAgendaSignals(
  db: Db,
  countryId: CountryId
): Promise<CrisisAgendaIntake> {
  const crises = await db
    .collection<Crisis>("crises")
    .find({ status: "active", $or: [{ countryIds: countryId }, { scope: "global" }] })
    .toArray();

  const signals: Record<string, number> = {};
  let latestStartTurn = 0;
  for (const crisis of crises) {
    const crisisSignals = crisisSignalsFromEffects(crisis.effects ?? []);
    if (Object.keys(crisisSignals).length === 0) continue;
    for (const [domain, severity] of Object.entries(crisisSignals)) {
      signals[domain] = Math.max(signals[domain] ?? 0, severity);
    }
    if (crisis.startTurn > latestStartTurn) latestStartTurn = crisis.startTurn;
  }
  return { signals, latestStartTurn };
}
