import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import {
  assessDemocraticCompetition,
  type DemocraticCompetition,
  type SeatControlHistoryRow,
} from "./competition";

interface ParliamentSeatHistoryDoc extends SeatControlHistoryRow {
  countryId: string;
  officeType: string;
}

export async function loadDemocraticCompetition(
  db: Db,
  countryId: CountryId,
  preset: string | undefined,
  gameState: Pick<GameState, "presidentialTenureByCountry"> | null
): Promise<DemocraticCompetition> {
  const lowerChamber = getCountryConfig(countryId, preset).legislature.lowerChamber.key;
  const [officials, history] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, officeType: lowerChamber })
      .project<Pick<ElectedOfficial, "party" | "seatsHeld">>({ party: 1, seatsHeld: 1 })
      .toArray(),
    db
      .collection<ParliamentSeatHistoryDoc>("parliamentSeatsHistory")
      .find({ countryId, officeType: lowerChamber })
      .sort({ turn: 1 })
      .toArray(),
  ]);

  const seatsByParty: Record<string, number> = {};
  for (const official of officials) {
    if (!official.party) continue;
    seatsByParty[official.party] = (seatsByParty[official.party] ?? 0) + (official.seatsHeld ?? 1);
  }

  return assessDemocraticCompetition({
    seatsByParty,
    history,
    consecutiveExecutiveTerms:
      gameState?.presidentialTenureByCountry?.[countryId]?.consecutiveTerms ?? 0,
  });
}
