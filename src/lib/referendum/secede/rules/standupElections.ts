/** Immediate regional elections for newly independent countries. */
import type { Election, State } from "@/lib/db/types";
import { getCountryConfig } from "@/lib/constants/countries";
import { getElectionMethod } from "@/lib/elections/electionMethod";
import { getSeatIdFromElection } from "@/lib/seats";
import { withCampaignRules } from "@/lib/campaignTargeting/rules";
import { yearOfTurn } from "@/lib/utils/gameDate";
import {
  SCO_REGIONAL_COUNCIL_SEATS,
  WAL_REGIONAL_COUNCIL_SEATS,
} from "@/lib/turn/perpetualElections/shared";
import type { SecedingCountryId } from "../subRegions";
export function buildStandupElections(input: {
  countryId: SecedingCountryId;
  regions: State[];
  currentTurn: number;
  now: Date;
  startingYear: number;
  preset?: string;
  id: () => string;
}) {
  const { countryId, regions, currentTurn, now, startingYear, preset, id } = input;
  const chamber = getCountryConfig(countryId).legislature.lowerChamber.key;
  const councils = countryId === "SCO" ? SCO_REGIONAL_COUNCIL_SEATS : WAL_REGIONAL_COUNCIL_SEATS;
  for (const region of regions) {
    if (
      !Number.isSafeInteger(region.houseDistricts) ||
      region.houseDistricts <= 0 ||
      !(councils[region._id] > 0)
    )
      throw new Error("Invalid successor election apportionment");
  }
  const rows: Array<Omit<Election, "_id"> & { _id: string }> = regions.flatMap((region) =>
    [
      { type: `snap_${chamber}`, seats: region.houseDistricts },
      { type: "governor", seats: 1 },
      { type: "regionalCouncil", seats: councils[region._id] },
    ].map(
      ({ type, seats }) =>
        withCampaignRules({
          _id: id(),
          countryId,
          electionType: type,
          state: region._id,
          allocationMethod: getElectionMethod(countryId, type, preset),
          seatId: getSeatIdFromElection({
            countryId,
            electionType: type.startsWith("snap_") ? chamber : type,
            state: region._id,
          }),
          cycle: 1,
          electionYear: yearOfTurn(currentTurn + 48, startingYear),
          status: "active",
          imposedSnap: true,
          totalSeats: seats,
          startTime: now,
          primaryEndTime: new Date(now.getTime() + 24 * 3600000),
          endTime: new Date(now.getTime() + 48 * 3600000),
          startTurn: currentTurn,
          primaryEndTurn: currentTurn + 24,
          endTurn: currentTurn + 48,
          durationHours: 48,
          primaryDurationHours: 24,
          createdAt: now,
          updatedAt: now,
        }) as Omit<Election, "_id"> & { _id: string }
    )
  );
  return { rows, councils };
}
