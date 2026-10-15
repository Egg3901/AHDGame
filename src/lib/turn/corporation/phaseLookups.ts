import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";
import { resolveNoBuyerPhaseOutStartTurn } from "@/lib/extraction/noBuyerPhaseOutStart";
import { placementRevenuePhaseStartTurnFrom } from "@/lib/market/placementRevenuePhase";
import {
  announceCountryRecessions,
  countryRecessionsFrom,
  recessionCapacityFactors,
} from "@/lib/market/countryRecession";
import type { CorporationLookups } from "./types";

/**
 * Operator-scheduled phases the corporation turn reads from gameConfig: the
 * no-buyer extraction phase-out, the revenue-follows-placement phase-in and
 * country recessions (announced on their first active turn). Kept out of the
 * turn module so adding a phase does not push it over the size limit.
 */
export async function resolvePhaseLookups(
  db: Db,
  config:
    | Pick<
        GameConfig,
        | "extractionNoBuyerPhaseOutStartTurn"
        | "placementRevenuePhaseStartTurn"
        | "countryRecessions"
      >
    | null
    | undefined,
  turn: number,
  lookups: Pick<
    CorporationLookups,
    | "extractionNoBuyerPhaseOutStartTurn"
    | "placementRevenuePhaseStartTurn"
    | "recessionCapacityFactorByCountry"
  >
): Promise<void> {
  lookups.extractionNoBuyerPhaseOutStartTurn = await resolveNoBuyerPhaseOutStartTurn(
    db,
    config,
    turn
  );
  lookups.placementRevenuePhaseStartTurn = placementRevenuePhaseStartTurnFrom(config);
  const recessions = countryRecessionsFrom(config);
  lookups.recessionCapacityFactorByCountry = recessionCapacityFactors(recessions, turn);
  if (recessions.length > 0) await announceCountryRecessions(db, recessions, turn);
}
