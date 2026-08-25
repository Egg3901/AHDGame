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
  const legislature = getCountryConfig(countryId, preset).legislature;
  const chamberKeys = [legislature.lowerChamber.key];
  if (legislature.bicameral && legislature.upperChamber) {
    chamberKeys.push(legislature.upperChamber.key);
  }
  const officeType = chamberKeys.length === 1 ? chamberKeys[0] : { $in: chamberKeys };
  const [officials, history] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId, officeType })
      .project<Pick<ElectedOfficial, "officeType" | "party" | "seatsHeld">>({
        officeType: 1,
        party: 1,
        seatsHeld: 1,
      })
      .toArray(),
    db
      .collection<ParliamentSeatHistoryDoc>("parliamentSeatsHistory")
      .find({ countryId, officeType })
      .sort({ turn: 1 })
      .toArray(),
  ]);

  const chamberTallies = new Map<string, Record<string, number>>();
  for (const official of officials) {
    if (!official.party) continue;
    const seatsByParty = chamberTallies.get(official.officeType) ?? {};
    seatsByParty[official.party] = (seatsByParty[official.party] ?? 0) + (official.seatsHeld ?? 1);
    chamberTallies.set(official.officeType, seatsByParty);
  }

  return assessDemocraticCompetition({
    chambersByParty: chamberKeys.map((key) => chamberTallies.get(key) ?? {}),
    history,
    consecutiveExecutiveTerms:
      gameState?.presidentialTenureByCountry?.[countryId]?.consecutiveTerms ?? 0,
  });
}
