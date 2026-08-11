import type { Db } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial } from "@/lib/db/types";
import type { ImpeachmentVoteValue } from "@/lib/db/types/impeachment";

export interface ChamberTally {
  for: number;
  against: number;
  seats: number;
}

/**
 * Country-scoped filter for chamber officials. US executive/legislative rows
 * predate the explicit countryId, so keep matching legacy US docs that lack it
 * (mirrors getExecutiveOfficialFilter).
 */
function chamberOfficialFilter(
  countryId: CountryId,
  officeType: string,
  state?: string
): Record<string, unknown> {
  const stateScope = state ? { state } : {};
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return { officeType, ...stateScope, $or: [{ countryId }, { countryId: { $exists: false } }] };
  }
  return { officeType, countryId, ...stateScope };
}

/**
 * Seat-weighted tally of an impeachment vote map for one chamber. Votes are
 * keyed by characterId or `npp_<id>`; each seated official contributes
 * `seatsHeld` weight (multi-seat NPP blocs count fully). Abstentions and stale
 * voters (no longer seated) contribute nothing to for/against. Recomputed from
 * live seats at resolution time so the cached tally fields are display-only.
 */
export async function tallyImpeachmentChamber(
  db: Db,
  countryId: CountryId,
  officeType: string,
  votes: Record<string, ImpeachmentVoteValue> | undefined,
  state?: string
): Promise<ChamberTally> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(chamberOfficialFilter(countryId, officeType, state))
    .project<Pick<ElectedOfficial, "characterId" | "nppId" | "seatsHeld">>({
      characterId: 1,
      nppId: 1,
      seatsHeld: 1,
    })
    .toArray();

  const seatByKey = new Map<string, number>();
  let seats = 0;
  for (const o of officials) {
    const weight = o.seatsHeld ?? 1;
    seats += weight;
    if (o.characterId) seatByKey.set(o.characterId.toString(), weight);
    if (o.nppId) seatByKey.set(`npp_${o.nppId.toString()}`, weight);
  }

  let votesFor = 0;
  let votesAgainst = 0;
  if (votes) {
    for (const [key, vote] of Object.entries(votes)) {
      const weight = seatByKey.get(key);
      if (!weight) continue;
      if (vote === "aye") votesFor += weight;
      else if (vote === "nay") votesAgainst += weight;
    }
  }
  return { for: votesFor, against: votesAgainst, seats };
}

/** House impeaches on a seat-weighted simple majority of votes cast. */
export function passesHouseImpeachment(t: ChamberTally): boolean {
  return t.for > t.against;
}

/**
 * Senate convicts on a seat-weighted two-thirds of votes cast (abstentions
 * excluded); no votes cast fails. Mirrors meetsBillPassRule("twoThirds").
 */
export function passesSenateConviction(t: ChamberTally): boolean {
  const cast = t.for + t.against;
  return cast > 0 && t.for * 3 >= 2 * cast;
}
