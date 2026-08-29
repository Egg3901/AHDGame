/**
 * Convert a transferring region's `states` document to the target country's
 * conventions, and size its legislative allocation by population share.
 *
 * For NIR → Ireland: the region stays a single playable unit but becomes an
 * Irish PR-STV region (province "Ulster", `rcv`), with its Dáil seats
 * (`houseDistricts`) and Seanad seats (`stateSenateSeats`) allocated at the
 * Irish per-seat population ratio so the chambers grow proportionally.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";

/**
 * Seats for a region at the peers' average people-per-seat ratio, rounded and
 * floored at 1. `peers` are the target country's existing regions (population +
 * their seat count for the chamber being sized).
 */
export function populationShareSeats(
  regionPopulation: number,
  peers: Array<{ population?: number; seats?: number }>
): number {
  const totalPop = peers.reduce((s, p) => s + (p.population ?? 0), 0);
  const totalSeats = peers.reduce((s, p) => s + (p.seats ?? 0), 0);
  if (totalPop <= 0 || totalSeats <= 0) return 1;
  const peoplePerSeat = totalPop / totalSeats;
  return Math.max(1, Math.round(regionPopulation / peoplePerSeat));
}

export interface ConvertRegionDocArgs {
  regionId: string;
  toCountryId: CountryId;
  /** Province grouping under the target country (NIR → "Ulster"). */
  province: string;
  /** Optional display name the region takes in its new country, replacing its
   *  origin-country name (NIR → "Ulster", from "Northern Ireland"). */
  displayName?: string;
  /**
   * The electoral system the region adopts. Defaults to `rcv`, which is
   * IRELAND's system and was hardcoded here when this function had exactly one
   * caller. It is not a universal default: a Land joining Germany keeps `fptp`,
   * and forcing it to PR-STV would silently re-run its elections under rules
   * neither country uses.
   */
  votingSystem?: State["votingSystem"];
}

export async function convertRegionDoc(db: Db, args: ConvertRegionDocArgs): Promise<void> {
  const { regionId, toCountryId, province, displayName, votingSystem } = args;
  const now = new Date();

  const region = await db.collection<State>("states").findOne({ _id: regionId });
  const population = region?.population ?? 0;

  const peers = await db.collection<State>("states").find({ countryId: toCountryId }).toArray();

  // ⚠️ DO NOT source this from the `seats` collection. A `DE-bundestag-<Land>`
  // document holds that Land's WAHLKREIS count under the additive-member system
  // (299 across Germany), not its delegation: Berlin's seat doc says 12 while its
  // `houseDistricts` is 25, and `getLiveLowerChamberSeats` sums the latter to get
  // the real 487-seat Bundestag. Reading the seat doc here halves every joining
  // Land's representation. (`stateSenateSeats` happens to equal its landtag seat
  // doc exactly, which makes the mistake easy to make and easy to miss.)
  const houseDistricts = populationShareSeats(
    population,
    peers.map((p) => ({ population: p.population, seats: p.houseDistricts }))
  );
  const stateSenateSeats = populationShareSeats(
    population,
    peers.map((p) => ({ population: p.population, seats: p.stateSenateSeats }))
  );

  await db.collection<State>("states").updateOne(
    { _id: regionId },
    {
      $set: {
        countryId: toCountryId,
        regionType: "region",
        region: province,
        ...(displayName ? { name: displayName } : {}),
        votingSystem: votingSystem ?? "rcv",
        houseDistricts,
        stateSenateSeats,
        updatedAt: now,
      },
      $unset: { parentRegionId: "" },
    }
  );
}
