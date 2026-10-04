/**
 * appointNppPrimeMinister — autonomous parliamentary government formation (SP3).
 *
 * In a disabled/econ-only parliamentary country, no player character is ever
 * available to be nominated PM, so `getPmAppointmentCandidates` (which filters
 * `userId: { $exists: true }`) returns an empty list and the government stays
 * "pending" forever — the same `userId`-filter stall SP1 fixed for the central
 * bank chair. This chooses a cabinet with compatible coalition support or explicit
 * tolerance, then seats its leading party's senior NPP legislator.
 *
 * Safety rail: only acts where `isNppAutonomyActive` is true (autonomy enabled
 * AND the country is NOT player-enabled). The player formation path is never
 * touched when autonomy is inactive.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig } from "@/lib/constants/countries";
import type { ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { tallySeatsByParty, appointPrimeMinister } from "@/lib/turn/parliamentaryGovernment";
import { chooseAutonomousCabinet } from "@/lib/government/rules/autonomousSupport";
import { isNppAutonomyActive } from "./featureFlag";

/**
 * Seat an NPP Prime Minister for `countryId` when government formation has
 * stalled in "pending". Returns true when a PM was seated this call, false
 * when nothing was done (inactive, already formed, or no eligible NPP MP).
 */
export async function appointNppPrimeMinister(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date,
  preset?: string
): Promise<boolean> {
  // Safety rail — never fire in player-enabled countries.
  if (!(await isNppAutonomyActive(db, countryId))) return false;

  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });
  // Only seat when a formation is genuinely open. A formed government (player
  // OR a previously-seated NPP) is left untouched, so this is idempotent.
  if (!gov || gov.status !== "pending") return false;

  const seatsByParty = await tallySeatsByParty(db, countryId, preset);
  if (!Object.keys(seatsByParty).length) return false;

  // Seated lower-chamber NPP MPs available to lead a viable cabinet. A player-character PM is
  // impossible here (country is not player-enabled), so we pick from NPPs.
  const lowerOfficeType = getLowerChamberOfficeType(countryId, preset);
  const nppMps = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId,
      officeType: lowerOfficeType,
      isNPP: true,
      nppId: { $exists: true, $ne: null },
    })
    .toArray();
  if (nppMps.length === 0) return false;

  const majorityThreshold =
    gov.majorityThreshold ?? getCountryConfig(countryId, preset).coalitionThreshold;
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId, sequentialId: { $in: Object.keys(seatsByParty).map(Number) } },
      { projection: { sequentialId: 1, economicPosition: 1, socialPosition: 1 } }
    )
    .toArray();
  const support = chooseAutonomousCabinet(
    Object.entries(seatsByParty).map(([id, seats]) => {
      const party = parties.find((p) => String(p.sequentialId) === id);
      return {
        id,
        seats,
        economic: party?.economicPosition ?? null,
        social: party?.socialPosition ?? null,
      };
    }),
    nppMps.flatMap((mp) => (mp.party ? [mp.party] : [])),
    majorityThreshold
  );
  if (!support) return false;
  const governingPartyId = support.leadPartyId;
  const eligibleMps = nppMps.filter((mp) => mp.party === governingPartyId);

  // Deterministic "party leader": most seats held, tie-break lowest nppId
  // string. (NPP sequentialId is not loaded in the turn context, so the id
  // string is the stable cross-turn tie-break.)
  eligibleMps.sort((a, b) => {
    const seatsDiff = (b.seatsHeld ?? 1) - (a.seatsHeld ?? 1);
    if (seatsDiff !== 0) return seatsDiff;
    return (a.nppId?.toString() ?? "") < (b.nppId?.toString() ?? "") ? -1 : 1;
  });
  const pmOfficial = eligibleMps[0];
  if (!pmOfficial.nppId) return false;

  const npp = await db
    .collection<NPP>("npps")
    .findOne({ _id: pmOfficial.nppId }, { projection: { name: 1 } });
  if (!npp) return false;

  // Seat the NPP as head of government: clears any prior PM, sets the NPP's
  // currentOffice, records country history + Discord. Player path untouched.
  await appointPrimeMinister(db, countryId, null, npp._id, npp.name, now, preset);

  const govPartySeats = seatsByParty[governingPartyId] ?? 0;
  const supporting = support.supporting.length ? support.supporting : [governingPartyId];
  const supportingSeats = supporting.reduce((sum, party) => sum + (seatsByParty[party] ?? 0), 0);
  const formationType =
    supportingSeats >= majorityThreshold
      ? supporting.length > 1
        ? "coalition"
        : "majority"
      : "minority";

  await govCol.updateOne(
    { _id: countryId },
    {
      $set: {
        status: "formed",
        formationType,
        lostMajority: false,
        pmCharacterId: null,
        pmNppId: npp._id,
        pmName: npp.name,
        governingPartyId,
        coalitionId: null,
        coalitionPartyIds: supporting.length > 1 ? supporting : null,
        confidenceAbstentionPartyIds: support.abstaining,
        totalSeatsSupporting: supportingSeats,
        activeVoteId: null,
        formedAt: now,
        formedTurn: currentTurn,
        collapsedAt: null,
        // PM seated → clear the vacancy watcher's auto-snap deadline.
        pmVacancyDeadlineTurn: null,
        snapElectionsUsed: 0,
        lastSnapElectionTurn: null,
        updatedAt: now,
      },
    }
  );

  console.log(
    `[nppAutonomy] ${countryId}: seated NPP PM ${npp.name} (party ${governingPartyId}, ${formationType}, ${govPartySeats} seats)`
  );
  return true;
}
