/**
 * Evacuate a transferring region's UK-era political + economic actors so it can
 * join the target country as a clean slate (the target re-seeds its own parties,
 * NPPs, and seats). Replaces the old party/official migration — NO party doc
 * moves, so the source country's national parties are never disturbed.
 *
 *  - NPP politicians resident in the region RELOCATE to `relocateToRegionId`,
 *    staying in the SOURCE country and dropping any office. A corporation an
 *    evacuated NPP CEOs follows them there for free.
 *  - Player characters resident in the region become Independent (the resident
 *    rescope then flips their countryId to the target; homeState stays put).
 *  - The region's party orgs, officeholders, and seat docs are deleted.
 *  - Any remaining corporations HQ'd in the region follow it into the target.
 *
 * Runs BEFORE `rescopeRegionToCountry`: NPPs are relocated out first (so they
 * stay in the source country), leaving only player residents for the rescope.
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NPP } from "@/lib/db/types/npp";

/** Region-scoped party collections dissolved on transfer (target re-seeds). */
const REGION_PARTY_COLLECTIONS = [
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
  // and cross with it, becoming the target's. Either way they drop their office
  // — the body they sat in does not survive the transfer.
  const dissolving = relocateToRegionId === null;
  if (nppIds.length) {
    await db.collection<NPP>("npps").updateMany(
      { _id: { $in: nppIds } },
      {
        $set: {
          homeState: dissolving ? regionId : relocateToRegionId,
          ...(dissolving ? { countryId: toCountryId } : {}),
          currentOffice: null,
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

  // 2. Player residents become Independent AND vacate every source-country
  //    office — a foreign citizen can't hold national office (cabinet, national
  //    seats, head-of-government). The resident rescope flips their countryId to
  //    the target afterward.
  const playerDocs = await db
    .collection("characters")
    .find({ homeState: regionId, userId: { $ne: null } })
    .project({ _id: 1 })
    .toArray();
  const playerIds = playerDocs.map((p) => p._id);
  let playersToIndependent = 0;
  if (playerIds.length > 0) {
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

  // 3. Delete the region's party orgs (the target re-seeds its own).
  let partyDocsDeleted = 0;
  for (const coll of REGION_PARTY_COLLECTIONS) {
    const res = await db.collection(coll).deleteMany({ stateId: regionId });
    partyDocsDeleted += res?.deletedCount ?? 0;
  }

  // 4. Dissolve every officeholder + seat in the region (seats vacated; the
  //    target re-seeds its own chamber/local seats via the election engine).
  const officials = await db
    .collection("electedOfficials")
    .deleteMany({ countryId: fromCountryId, state: regionId });
  const seats = await db
    .collection("seats")
    .deleteMany({ countryId: fromCountryId, state: regionId });

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
    officialsDissolved: officials?.deletedCount ?? 0,
    seatsDissolved: seats?.deletedCount ?? 0,
    electionsDissolved,
    corpsToTarget: corpsToTarget?.modifiedCount ?? 0,
  };
}
