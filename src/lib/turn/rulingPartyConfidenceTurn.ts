import type { Db } from "mongodb";
import { getCountryLeaderStatesCollection } from "@/lib/db/collections/countryLeaderState";
import { adjustLeaderConfidence } from "@/lib/turn/rulingPartyConfidence";
import {
  computeTurnDrift,
  getConfidenceConsequenceLevel,
  CONFIDENCE_CONSEQUENCE_DESCRIPTIONS,
  type PurgeEvent,
  type TurnDriftResult,
} from "@/lib/turn/rulingPartyPriorities";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";

/**
 * Process one turn of ruling-party confidence drift for a single one-party
 * state country. Called once per turn per country from
 * `processOnePartyBillLifecycle`.
 *
 * Steps:
 * 1. Fetch the country's current leader from governmentFormations.
 * 2. Fetch their confidence state.
 * 3. Compute drift from recent policies and unprocessed purges.
 * 4. Apply the delta to confidence.
 * 5. Log consequences if thresholds are crossed.
 * 6. Return the result for telemetry/logging.
 */
export interface RulingPartyConfidenceTurnResult {
  leaderId: string;
  previousConfidence: number;
  newConfidence: number;
  delta: number;
  driftDetails: TurnDriftResult;
  consequenceLevel: ReturnType<typeof getConfidenceConsequenceLevel>;
  consequenceDescription: string;
  purgeEventsProcessed: number;
}

export async function processRulingPartyConfidenceTurn(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  policyCategories: string[] = [],
  purgeEvents: PurgeEvent[] = []
): Promise<RulingPartyConfidenceTurnResult | null> {
  // 1. Find current country leader
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov || !gov.pmCharacterId) {
    return null; // No leader installed yet
  }

  const leaderId = gov.pmCharacterId;

  // 2. Fetch confidence state
  const stateColl = getCountryLeaderStatesCollection(db);
  const stateId = `${countryId}_${leaderId.toString()}`;
  const state = await stateColl.findOne({ _id: stateId });
  if (!state) {
    return null; // No confidence state yet (leader not initialized)
  }

  // 3. Compute drift — uses per-country priority profile + axis effects
  // from CountryConfig (falls back to CN-shaped defaults if either is unset,
  // which preserves backward compatibility during the Phase 3 rollout).
  // Phase 3: passes the leader's current popularLegitimacy so the
  // popular→party coupling bleed contributes to the drift when popular
  // collapse is severe.
  const config = getCountryConfig(countryId);
  const drift = computeTurnDrift(
    {
      policyCategories,
      activePurgeEvents: purgeEvents,
      popularLegitimacy: state.popularLegitimacy,
    },
    config.priorityProfile,
    config.policyAxisEffects
  );

  // 4. Apply delta
  const previousConfidence = state.partyConfidence;
  const newConfidence = await adjustLeaderConfidence(
    db,
    countryId,
    leaderId,
    drift.totalDelta,
    `Turn ${currentTurn} drift: policy=${drift.policyDelta}, purge=${drift.purgeDelta}`,
    currentTurn
  );

  if (!newConfidence) {
    return null;
  }

  // 5. Determine consequences
  const consequenceLevel = getConfidenceConsequenceLevel(newConfidence.partyConfidence);
  const consequenceDescription = CONFIDENCE_CONSEQUENCE_DESCRIPTIONS[consequenceLevel];

  return {
    leaderId: leaderId.toString(),
    previousConfidence,
    newConfidence: newConfidence.partyConfidence,
    delta: drift.totalDelta,
    driftDetails: drift,
    consequenceLevel,
    consequenceDescription,
    purgeEventsProcessed: drift.details.purges.length,
  };
}
