import type { Db } from "mongodb";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
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
  const config = getCountryConfig(countryId, preset);
  const legislature = config.legislature;
  const chamberKeys = [legislature.lowerChamber.key];
  if (legislature.bicameral && legislature.upperChamber) {
    chamberKeys.push(legislature.upperChamber.key);
  }
  const officeType = chamberKeys.length === 1 ? chamberKeys[0] : { $in: chamberKeys };
  const [officials, history, courtSeats] = await Promise.all([
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
    countryId === "US"
      ? db
          .collection<SupremeCourtSeat>("supremeCourtSeats")
          .find({ countryId: "US" })
          .project<
            Pick<
              SupremeCourtSeat,
              "justiceParty" | "justiceMode" | "justiceCharacterId" | "justiceNppId"
            >
          >({
            justiceParty: 1,
            justiceMode: 1,
            justiceCharacterId: 1,
            justiceNppId: 1,
          })
          .toArray()
      : Promise.resolve([]),
  ]);

  const chamberTallies = new Map<string, Record<string, number>>();
  for (const official of officials) {
    if (!official.party) continue;
    const seatsByParty = chamberTallies.get(official.officeType) ?? {};
    seatsByParty[official.party] = (seatsByParty[official.party] ?? 0) + (official.seatsHeld ?? 1);
    chamberTallies.set(official.officeType, seatsByParty);
  }

  const executiveTenure = gameState?.presidentialTenureByCountry?.[countryId];
  const hasSeparateExecutive = config.governmentType === "presidential";

  const justicesByParty: Record<string, number> = {};
  for (const seat of courtSeats) {
    const occupied =
      seat.justiceCharacterId != null ||
      seat.justiceNppId != null ||
      seat.justiceMode === "historical";
    if (!occupied || !seat.justiceParty) continue;
    justicesByParty[seat.justiceParty] = (justicesByParty[seat.justiceParty] ?? 0) + 1;
  }

  return assessDemocraticCompetition({
    chambersByParty: chamberKeys.map((key) => chamberTallies.get(key) ?? {}),
    history,
    executivePartyId: hasSeparateExecutive ? executiveTenure?.party : null,
    consecutiveExecutiveTerms: hasSeparateExecutive ? (executiveTenure?.consecutiveTerms ?? 0) : 0,
    justicesByParty,
  });
}
