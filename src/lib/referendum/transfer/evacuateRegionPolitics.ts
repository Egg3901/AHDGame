/**
 * Prepare a transferring region's political actors for their new country.
 *
 * TWO MODES, chosen by `relocateToRegionId`, and they are near-opposites.
 *
 * EVACUATE (`relocateToRegionId` is a region id — the source country SURVIVES).
 * The region joins the target as a clean slate and the target re-seeds its own
 * parties, NPPs and seats. NPP politicians relocate to the named region, staying
 * in the source country and dropping any office; player residents become
 * Independent and vacate every source-country office, because a foreign citizen
 * cannot hold one; the region's party orgs, officeholders and seats are deleted.
 * This is Northern Ireland leaving the United Kingdom.
 *
 * CARRY (`relocateToRegionId` is null — the source country is DISSOLVING).
 * There is no rest-of-country to retreat into and no source institutions worth
 * protecting, so the region takes its politics with it. NPPs cross with the
 * region; players keep their party, their seat and their cabinet post;
 * officeholders are remapped onto the absorbing country's equivalent offices and
 * their seat counts rescaled onto the chamber they are joining; the party
 * organisations are re-scoped rather than deleted, which is what carries each
 * party's treasury and registration ledger across. This is East Germany merging
 * into Germany.
 *
 * NO PARTY DOCUMENT MOVES HERE in either mode. On the carry path
 * `mergePartiesIntoCountry` has already moved and renumbered them, which is why
 * the `party` values these rows carry are correct by the time this runs.
 *
 * Runs BEFORE `rescopeRegionToCountry`: on the evacuate path NPPs are relocated
 * out first so they stay in the source country, leaving only player residents
 * for the rescope.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types/npp";
import { officeRemapFor, remapOffice } from "@/lib/country/dissolvingOfficeRemap";

/**
 * Region-scoped party collections.
 *
 * DELETED when the source country survives (the target re-seeds its own),
 * RE-SCOPED when the source is dissolving. See the `dissolving` branches below:
 * a surviving source keeps its national parties and the departing region is
 * cleared for the target to rebuild, while a dissolving one has no parties left
 * to protect and every organisation it built travels with it.
 */
export const REGION_PARTY_COLLECTIONS = [
  "statePartyOrg",
  "partyBudget",
  "partyPoliticalStrengthLedger",
  "orgRegLedger",
  "billWhips",
  "statePartyElections",
];

export interface EvacuateRegionPoliticsArgs {
  regionId: string;
  fromCountryId: CountryId;
  toCountryId: CountryId;
  /**
   * Where evacuated NPPs (and their corporations) relocate, e.g. "LON".
   *
   * NULL when the source country is being DISSOLVED, not merely losing a
   * region. There is then no "rest of the country" to retreat into, so NPPs and
   * their corporations travel WITH the region into the target instead of being
   * relocated out of it. Passing a region id here when the source is dissolving
   * strands them in a country that is about to stop being simulated.
   */
  relocateToRegionId: string | null;
}

export interface EvacuateRegionPoliticsResult {
  nppsRelocated: number;
  corpsFollowedCeo: number;
  playersToIndependent: number;
  partyDocsDeleted: number;
  officialsDissolved: number;
  seatsDissolved: number;
  electionsDissolved: number;
  corpsToTarget: number;
  /** Officials carried into the absorbing country. Dissolving source only. */
  officialsRemapped: number;
  /** Officials whose office has no counterpart and ended with the country. */
  officialsRetired: number;
}

export async function evacuateRegionPolitics(
  db: Db,
  args: EvacuateRegionPoliticsArgs
): Promise<EvacuateRegionPoliticsResult> {
  const { regionId, fromCountryId, toCountryId, relocateToRegionId } = args;
  const now = new Date();

  // 1. Relocate NPP politicians OUT of the region (stay in the source country,
  //    drop any office). Capture ids first so their corporations can follow.
  const npps = await db
    .collection<NPP>("npps")
    .find({ homeState: regionId })
    .project({ _id: 1 })
    .toArray();
  const nppIds = npps.map((n) => n._id);
  // A dissolving source has nowhere to retreat to: the NPPs stay in the region
  // and cross with it, becoming the target's.
  //
  // THE OFFICE IS DROPPED ONLY WHEN THE SOURCE SURVIVES. On that path the body
  // they sat in does not survive the transfer, so holding an office in it is
  // meaningless. On the dissolving path the body DOES survive -- remapped onto
  // the absorbing country's equivalent chamber below -- and most officeholders
  // here are NPPs rather than players, so nulling this would strip the office
  // from the majority of the seats the merge just carried, leaving their
  // `electedOfficials` row intact and the politician holding nothing.
  const dissolving = relocateToRegionId === null;
  if (nppIds.length) {
    await db.collection<NPP>("npps").updateMany(
      { _id: { $in: nppIds } },
      {
        $set: {
          homeState: dissolving ? regionId : relocateToRegionId,
          ...(dissolving ? { countryId: toCountryId } : { currentOffice: null }),
          updatedAt: now,
        },
      }
    );
  }

  // 1b. A corporation an evacuated NPP CEOs follows them — for free — to the
  //     same destination. Where that is depends on whether the source survives:
  //     to another of its regions if so, into the target with the region if not.
  let corpsFollowedCeo = 0;
  if (nppIds.length) {
    const res = await db.collection("corporations").updateMany(
      { ceoType: "npp", ceoId: { $in: nppIds } },
      {
        $set: {
          headquartersState: dissolving ? regionId : relocateToRegionId,
          countryId: dissolving ? toCountryId : fromCountryId,
          updatedAt: now,
        },
      }
    );
    corpsFollowedCeo = res?.modifiedCount ?? 0;
  }

  // 2. Player residents.
  //
  // A SURVIVING source strips them: a foreign citizen cannot hold national office
  // (cabinet, national seats, head-of-government), so they go Independent and
  // vacate everything. The resident rescope flips their countryId afterward.
  //
  // A DISSOLVING source keeps them whole. Their country is being absorbed, not
  // left behind, and stripping the winning side's players of the institutions
  // they just won is the opposite of what a merge should do. Their `party` value
  // is already correct because `mergePartiesIntoCountry` renumbered it before
  // this region moved.
  const playerDocs = await db
    .collection("characters")
    .find({ homeState: regionId, userId: { $ne: null } })
    .project({ _id: 1 })
    .toArray();
  const playerIds = playerDocs.map((p) => p._id);
  let playersToIndependent = 0;
  if (playerIds.length > 0 && !dissolving) {
    const upd = await db.collection("characters").updateMany(
      { _id: { $in: playerIds } },
      {
        $set: { party: "independent", updatedAt: now },
        $unset: { currentOffice: "", cabinetPosition: "" },
      }
    );
    playersToIndependent = upd?.modifiedCount ?? 0;
    const heldInSource = { countryId: fromCountryId, characterId: { $in: playerIds } };
    for (const col of ["cabinetMembers", "electedOfficials"]) {
      await db.collection(col).deleteMany(heldInSource);
    }
    await db
      .collection<{ _id: string; headOfGovernmentCharacterId?: ObjectId }>("governmentFormations")
      .updateMany(
        { _id: fromCountryId, headOfGovernmentCharacterId: { $in: playerIds } },
        { $set: { updatedAt: now }, $unset: { headOfGovernmentCharacterId: "" } }
      );
  }
  // A dissolving source's CABINET is handled at country level, not here — see
  // `retireNationalRemnants`. Its seats are keyed by position id rather than by
  // region, and the two countries do not share that vocabulary: East Germany's
  // `minister_of_defence` has no counterpart in Germany's `defense_minister`, so
  // re-scoping the rows would seat ministers in portfolios the surviving country
  // does not define, alongside the ones it already has.

  // 3. The region's party organisations.
  //
  // Deleted when the source survives (the target re-seeds its own), RE-SCOPED when
  // it dissolves — this is what carries each party's treasury, its registration
  // ledger and its organisational strength across the border rather than
  // destroying them along with the state.
  let partyDocsDeleted = 0;
  for (const coll of REGION_PARTY_COLLECTIONS) {
    if (dissolving) {
      await db
        .collection(coll)
        .updateMany({ stateId: regionId }, { $set: { countryId: toCountryId, updatedAt: now } });
      continue;
    }
    const res = await db.collection(coll).deleteMany({ stateId: regionId });
    partyDocsDeleted += res?.deletedCount ?? 0;
  }

  // 4. Officeholders and seats.
  //
  // Dissolved and re-seeded when the source survives; REMAPPED when it does not.
  // An office with no counterpart in the absorbing country retires — see
  // `dissolvingOfficeRemap` for why that mapping is per-pair rather than generic.
  let officialsDissolved = 0;
  let seatsDissolved = 0;
  let officialsRemapped = 0;
  let officialsRetired = 0;

  if (dissolving) {
    ({ officialsRemapped, officialsRetired } = await carryOfficials(db, {
      regionId,
      fromCountryId,
      toCountryId,
      now,
    }));
  } else {
    const officials = await db
      .collection("electedOfficials")
      .deleteMany({ countryId: fromCountryId, state: regionId });
    officialsDissolved = officials?.deletedCount ?? 0;
    const seats = await db
      .collection("seats")
      .deleteMany({ countryId: fromCountryId, state: regionId });
    seatsDissolved = seats?.deletedCount ?? 0;
  }

  // 4b. Dissolve the region's source-country races + their candidates so they
  //     don't resolve into phantom source-country officeholders after it leaves;
  //     the target's election engine re-spawns the region's own races next turn.
  const regionElections = await db
    .collection<{ _id: ObjectId }>("elections")
    .find({ countryId: fromCountryId, state: regionId, status: { $in: ["active", "upcoming"] } })
    .project({ _id: 1 })
    .toArray();
  const electionIds = regionElections.map((e) => e._id);
  let electionsDissolved = 0;
  if (electionIds.length > 0) {
    await db.collection("electionCandidates").deleteMany({ electionId: { $in: electionIds } });
    const res = await db.collection("elections").deleteMany({ _id: { $in: electionIds } });
    electionsDissolved = res?.deletedCount ?? 0;
  }

  // 5. Any corporations still HQ'd in the region (player- or vacant-CEO'd) follow
  //    it into the target country, as their region becomes the target's.
  const corpsToTarget = await db
    .collection("corporations")
    .updateMany(
      { headquartersState: regionId },
      { $set: { countryId: toCountryId, updatedAt: now } }
    );

  return {
    nppsRelocated: nppIds.length,
    corpsFollowedCeo,
    playersToIndependent,
    partyDocsDeleted,
    officialsDissolved,
    seatsDissolved,
    electionsDissolved,
    corpsToTarget: corpsToTarget?.modifiedCount ?? 0,
    officialsRemapped,
    officialsRetired,
  };
}

/** One official as the carry-across reads it. */
interface CarriedOfficial {
  _id: ObjectId;
  officeType: string;
  party?: string;
  seatsHeld?: number;
  characterId?: ObjectId | null;
  nppId?: ObjectId | null;
}

/**
 * Carry a dissolving country's officeholders into the country absorbing it.
 *
 * TWO THINGS HAPPEN HERE and they are separable only in principle: the office
 * changes name, and the chamber changes SIZE. East Germany's Volkskammer seats
 * 500 against the eastern Laender's 48 Bundestag seats, so an official carrying
 * `seatsHeld` unchanged would arrive holding more of the chamber than the chamber
 * has. Shares travel; counts do not.
 *
 * Extracted from `evacuateRegionPolitics` because that function is already a
 * five-step sequence and this is the only step with arithmetic in it.
 */
async function carryOfficials(
  db: Db,
  params: { regionId: string; fromCountryId: CountryId; toCountryId: CountryId; now: Date }
): Promise<{ officialsRemapped: number; officialsRetired: number }> {
  const { regionId, fromCountryId, toCountryId, now } = params;
  let officialsRemapped = 0;
  let officialsRetired = 0;

  // NO TABLE, NO CARRY. An unregistered country pair has no statement about how
  // one constitution's offices become another's, and guessing would seat people
  // in bodies nobody mapped. Those officials are dissolved exactly as they were
  // before this path existed — the same outcome, made deliberate rather than
  // emergent from `remapOffice` returning null for every office in turn.
  if (!officeRemapFor(fromCountryId, toCountryId)) {
    const dropped = await db
      .collection("electedOfficials")
      .deleteMany({ countryId: fromCountryId, state: regionId });
    return { officialsRemapped: 0, officialsRetired: dropped?.deletedCount ?? 0 };
  }

  const officials = (await db
    .collection("electedOfficials")
    .find({ countryId: fromCountryId, state: regionId })
    .toArray()) as unknown as CarriedOfficial[];

  // THE OFFICE ONLY, NOT THE SEAT COUNT. The chamber they are joining is sized
  // from the region's `houseDistricts` / `stateSenateSeats`, and this runs BEFORE
  // `convertRegionDoc` has written those for the new country -- the region still
  // carries its old country's numbers. `transferRegion` rescales the delegation
  // immediately afterwards, once the size is real.
  for (const official of officials) {
    const targetOffice = remapOffice(fromCountryId, toCountryId, official.officeType);
    if (targetOffice === null) {
      await db.collection("electedOfficials").deleteOne({ _id: official._id });
      officialsRetired++;
      continue;
    }

    await db
      .collection("electedOfficials")
      .updateOne(
        { _id: official._id },
        { $set: { countryId: toCountryId, officeType: targetOffice, updatedAt: now } }
      );

    // `currentOffice` is a STORED denormalisation on the politician, not a
    // derived one, and `actionRefresh` looks the office key up in the country's
    // config to award its bonus. Someone left holding `volkskammerDeputy` in
    // Germany matches nothing there: they would show a defunct title and
    // silently lose the bonus their seat is meant to carry. Most of these seats
    // are NPP-held rather than player-held, so both cases matter.
    if (official.characterId) {
      await db
        .collection("characters")
        .updateOne(
          { _id: official.characterId },
          { $set: { "currentOffice.type": targetOffice, updatedAt: now } }
        );
    } else if (official.nppId) {
      await db
        .collection("npps")
        .updateOne(
          { _id: official.nppId },
          { $set: { "currentOffice.type": targetOffice, updatedAt: now } }
        );
    }
    officialsRemapped++;
  }

  return { officialsRemapped, officialsRetired };
}
