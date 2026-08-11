/**
 * PM vacancy deadline watcher.
 *
 * Runs once per turn for every parliamentary country. If a country's
 * governmentFormations.status is "pending" and the current turn is past
 * pmVacancyDeadlineTurn, triggers an auto-snap that bypasses the
 * per-appointment limit and cooldown.
 *
 * Runs AFTER runParliamentaryGovernmentPhases so a PM seated this turn has
 * their deadline cleared before the watcher checks.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig, supportsSnapElections } from "@/lib/constants/countries";
import { getParliamentaryCountryIds } from "@/lib/turn/parliamentaryGovernment";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { triggerSnapElection } from "@/lib/turn/snapElection";
import { logger } from "../observability/logger";

export interface ProcessPMVacancyDeadlinesResult {
  autoSnapsFired: CountryId[];
}

export async function processPMVacancyDeadlines(
  gameNow: Date,
  currentTurn: number,
  dbOverride?: Db
): Promise<ProcessPMVacancyDeadlinesResult> {
  const db = dbOverride ?? (await getDb());
  const autoSnapsFired: CountryId[] = [];

  for (const countryId of getParliamentaryCountryIds()) {
    const config = getCountryConfig(countryId);
    if (!supportsSnapElections(config)) continue;

    const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
    if (!gov) continue;
    if (gov.status !== "pending") continue;
    if (gov.pmVacancyDeadlineTurn == null) continue;
    if (currentTurn < gov.pmVacancyDeadlineTurn) continue;

    try {
      await triggerSnapElection(db, countryId, gameNow, {
        reason: "auto-snap",
        bypassLimits: true,
      });
      autoSnapsFired.push(countryId);
    } catch (err) {
      logger.error("Turn", `Auto-snap failed for ${countryId}`, err);
    }
  }

  return { autoSnapsFired };
}
