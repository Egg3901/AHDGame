/**
 * appointNppPresident — autonomous presidential government formation (V1.1).
 *
 * Presidential countries (BR, NG) never schedule a national presidential
 * election: `perpetualElections` only creates the president race for the US
 * (it is anchored to the US LARP presidential year and writes `countryId: "US"`
 * throughout). So in a disabled/econ-only presidential country no winner is
 * ever produced, `seatPresidentialExecutive` is never reached, and the
 * executive stays vacant forever — the presidential analogue of the
 * `userId`-filter stall that SP1/SP3 fixed for the chair and the PM.
 *
 * This seats the country's most electable NPP (highest national favorability,
 * the would-be presidential nominee) as head of state, mirroring
 * `appointNppPrimeMinister`. It is the executive-formation half of the V1
 * governing brain for presidential systems.
 *
 * Gating: `nppAutonomyAtLeast(v1)`. Deliberately NOT v0 — seating BR/NG
 * presidents is a new V1 capability, so v0 ("current shipped behavior") is
 * unchanged. The v1 gate also enforces the player rail: it is false in
 * player-enabled countries below v2, so this never seats over a player country.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getCountryConfig,
  isPresidentialGovernmentType,
  COUNTRIES_WITH_PRESIDENTIAL_ELECTION_CYCLES,
} from "@/lib/constants/countries";
import type { ElectedOfficial, NPP } from "@/lib/db/types";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { tallySeatsByParty } from "@/lib/turn/parliamentaryGovernment";
import { nppAutonomyAtLeast } from "./featureFlag";

/**
 * Seat an NPP president for `countryId` when the office is vacant. Returns true
 * when a president was seated this call, false when nothing was done (gate off,
 * not presidential, already seated, or no eligible NPP).
 */
export async function appointNppPresident(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  // V1 gate — also enforces the player rail (false below v2 in player countries).
  if (!(await nppAutonomyAtLeast(db, countryId, "v1"))) return false;

  const config = getCountryConfig(countryId);
  if (!isPresidentialGovernmentType(config.governmentType)) return false;

  // Countries with a live presidential-election cycle (US electoral-college
  // engine, NG bespoke engine) elect their President once active — skip the
  // appointment fallback there. A vacancy in such a country stays vacant until
  // the election cycle fills it (matching prod, where the US executive is only
  // seated by election resolution), rather than being party-blind appointed by
  // favorability. While still coming-soon the election cycle is gated off, so
  // the fallback still supplies a governing brain.
  if (
    COUNTRIES_WITH_PRESIDENTIAL_ELECTION_CYCLES.has(countryId) &&
    config.status !== "coming-soon"
  ) {
    return false;
  }

  // Idempotent: only act when no president currently holds the office.
  const presidentFilter = getExecutiveOfficialFilter(countryId, "president");
  const seated = await db.collection<ElectedOfficial>("electedOfficials").findOne(presidentFilter);
  if (seated && (seated.characterId || seated.nppId)) return false;

  const govCol = getGovernmentFormationsCollection(db);
  const gov = await govCol.findOne({ _id: countryId });
  // A formed government with a seated NPP president is left untouched.
  if (gov && gov.status === "formed" && gov.presidentNppId) return false;

  // Pick the most electable NPP: a directly-elected national executive is the
  // country's most prominent figure, so favorability is the electability proxy.
  // Deterministic tie-breaks (influence, then id) keep the choice stable.
  const candidates = await db
    .collection<NPP>("npps")
    .find({ countryId, retiredAt: null })
    .toArray();
  if (candidates.length === 0) return false;

  candidates.sort((a, b) => {
    const fav = (b.favorability ?? 0) - (a.favorability ?? 0);
    if (fav !== 0) return fav;
    const inf = (b.politicalInfluence ?? 0) - (a.politicalInfluence ?? 0);
    if (inf !== 0) return inf;
    return a._id.toString() < b._id.toString() ? -1 : 1;
  });
  const president = candidates[0];

  // Defensive: clear any stale NPP president/VP office in this country first, so
  // the country never ends a turn with two NPPs claiming the executive.
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId, "currentOffice.type": { $in: ["president", "vicePresident"] } },
      { $set: { currentOffice: null, updatedAt: now } }
    );

  // Upsert the president official record (NPP-held).
  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    presidentFilter,
    {
      $set: {
        countryId,
        officeType: "president",
        characterId: null,
        characterName: president.name,
        party: president.party,
        isNPP: true,
        nppId: president._id,
        electedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  // Seat the NPP as head of state.
  await db
    .collection<NPP>("npps")
    .updateOne(
      { _id: president._id },
      { $set: { currentOffice: { type: "president" }, updatedAt: now } }
    );

  // Record the formed presidential government, mirroring the PM path's fields.
  // pmName carries the head-of-government display string; presidentNppId is the
  // authoritative seat reference for presidential systems.
  if (gov) {
    // Tallied live from electedOfficials rather than `gov.seatsByParty`, a
    // write-triggered cache refreshed only on specific turn events that can
    // drift arbitrarily far from the real chamber (measured: BR/NG summed to
    // 0 against real totals of 513/360). A stale zero here would misreport
    // the seated president's own-party support in the formation record.
    const liveSeatsByParty = await tallySeatsByParty(db, countryId);
    const govPartySeats = liveSeatsByParty[president.party] ?? 0;
    await govCol.updateOne(
      { _id: countryId },
      {
        $set: {
          status: "formed",
          formationType: "majority",
          lostMajority: false,
          pmCharacterId: null,
          pmNppId: null,
          pmName: president.name,
          presidentNppId: president._id,
          presidentName: president.name,
          governingPartyId: president.party,
          coalitionId: null,
          coalitionPartyIds: null,
          totalSeatsSupporting: govPartySeats,
          activeVoteId: null,
          formedAt: now,
          formedTurn: currentTurn,
          collapsedAt: null,
          pmVacancyDeadlineTurn: null,
          updatedAt: now,
        },
      }
    );
  }

  console.log(
    `[nppAutonomy] ${countryId}: seated NPP president ${president.name} (party ${president.party})`
  );
  return true;
}
