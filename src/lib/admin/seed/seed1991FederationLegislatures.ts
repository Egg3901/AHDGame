import type { Db } from "mongodb";
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import type { PoliticalParty, State, StatePartyOrg } from "@/lib/db/types";
import { buildProportionalChamberSeats, sumSeatsHeld } from "@/lib/seeds/proportionalChamberSeats";
import { seedFromSeats, type SeedMode } from "@/lib/npp/seedHistorical";

const FEDERATIONS = ["CS", "YU"] as const;

type Region = Pick<State, "_id" | "houseDistricts" | "stateSenateSeats">;
type Party = Pick<PoliticalParty, "name" | "sequentialId">;
type Presence = Pick<StatePartyOrg, "stateId" | "partyId" | "organization" | "hasPresence">;

/** Build a bounded opening delegation from the preset's authored regional
 * party footprints. Yugoslav republican parties stay in their own regions;
 * the weights are scenario starting values, not claimed election returns. */
export function build1991FederationDelegationSeats(input: {
  countryId: CountryId;
  officeType: string;
  targetSeats: number;
  regionSeatField: "houseDistricts" | "stateSenateSeats";
  regions: readonly Region[];
  parties: readonly Party[];
  presence: readonly Presence[];
}): HistoricalSeat[] {
  const { countryId, officeType, targetSeats, regionSeatField, regions, parties, presence } = input;
  const magnitudes = regions.map((region) => ({
    id: String(region._id),
    seats: region[regionSeatField] ?? 0,
  }));
  if (
    !FEDERATIONS.some((id) => id === countryId) ||
    !officeType ||
    !Number.isSafeInteger(targetSeats) ||
    targetSeats <= 0 ||
    magnitudes.length === 0 ||
    new Set(magnitudes.map((region) => region.id)).size !== magnitudes.length ||
    magnitudes.some((region) => !Number.isSafeInteger(region.seats) || region.seats <= 0) ||
    magnitudes.reduce((sum, region) => sum + region.seats, 0) !== targetSeats
  )
    throw new Error("1991 federal delegation magnitudes do not match its chamber");
  const partyById = new Map(parties.map((party) => [String(party.sequentialId), party.name]));
  if (partyById.size !== parties.length || partyById.size === 0)
    throw new Error("1991 federal delegation needs distinct seeded parties");
  const seats: HistoricalSeat[] = [];
  for (const region of magnitudes) {
    const weights = presence
      .filter((entry) => entry.stateId === region.id && entry.hasPresence)
      .map((entry) => ({
        name: partyById.get(entry.partyId),
        weight: entry.organization,
      }));
    if (
      weights.length === 0 ||
      weights.some(
        (weight) => !weight.name || !Number.isFinite(weight.weight) || weight.weight <= 0
      ) ||
      new Set(weights.map((weight) => weight.name)).size !== weights.length
    )
      throw new Error(`1991 federal delegation has no valid parties in ${region.id}`);
    seats.push(
      ...buildProportionalChamberSeats({
        officeType,
        regions: [region],
        parties: weights as { name: string; weight: number }[],
        targetSeats: region.seats,
      })
    );
  }
  if (sumSeatsHeld(seats) !== targetSeats)
    throw new Error("1991 federal delegation did not conserve chamber seats");
  return seats;
}

/** The 1991 preset authors CS/YU parties and districts but no historicalSeats
 * rows. Seat their already defined 150+150 and 220+88 federal bodies after
 * all other historical officials, without replacing a player-held chamber. */
export async function seed1991FederationLegislatures(
  db: Db,
  preset: string,
  seedMode: SeedMode,
  log: (message: string) => void
): Promise<void> {
  if (preset !== "1991-default") return;
  for (const countryId of FEDERATIONS) {
    const config = getCountryConfig(countryId, preset);
    const [regions, parties, presence] = await Promise.all([
      db
        .collection<State>("states")
        .find({ countryId }, { projection: { _id: 1, houseDistricts: 1, stateSenateSeats: 1 } })
        .toArray(),
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, isDefault: true }, { projection: { name: 1, sequentialId: 1 } })
        .toArray(),
      db
        .collection<StatePartyOrg>("statePartyOrg")
        .find(
          { countryId, hasPresence: true },
          { projection: { stateId: 1, partyId: 1, organization: 1, hasPresence: 1 } }
        )
        .toArray(),
    ]);
    const lower = build1991FederationDelegationSeats({
      countryId,
      officeType: getLowerChamberOfficeType(countryId, preset),
      targetSeats: config.legislature.lowerChamber.seats,
      regionSeatField: "houseDistricts",
      regions,
      parties,
      presence,
    });
    const upperOffice = getUpperChamberOfficeType(countryId, preset);
    const upper =
      upperOffice && config.legislature.upperChamber
        ? build1991FederationDelegationSeats({
            countryId,
            officeType: upperOffice,
            targetSeats: config.legislature.upperChamber.seats,
            regionSeatField: "stateSenateSeats",
            regions,
            parties,
            presence,
          })
        : [];
    const result = await seedFromSeats(db, [...lower, ...upper], seedMode, {
      skipAlreadySeatedChambers: true,
    });
    log(
      `Seeded ${countryId} 1991 federal delegations: ${result.officialsCreated} officials, ${result.nppsCreated} NPPs`
    );
  }
}
