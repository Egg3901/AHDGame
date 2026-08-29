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
import { remapOffice } from "@/lib/country/dissolvingOfficeRemap";
import { apportionSeats } from "@/lib/country/seatApportionment";

/**
 * Region-scoped party collections.
 *
 * DELETED when the source country survives (the target re-seeds its own),
 * RE-SCOPED when the source is dissolving. See the `dissolving` branches below:
 * a surviving source keeps its national parties and the departing region is
 * cleared for the target to rebuild, while a dissolving one has no parties left
 * to protect and every organisation it built travels with it.
 */
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
  } else if (playerIds.length > 0) {
    // Cabinet seats follow the country. The body they served is gone, but the rows
    // are re-scoped rather than deleted so the absorbing state inherits a staffed
    // cabinet rather than an empty one.
    await db
      .collection("cabinetMembers")
      .updateMany(
        { countryId: fromCountryId, characterId: { $in: playerIds } },
        { $set: { countryId: toCountryId, updatedAt: now } }
      );
  }

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

  const officials = (await db
    .collection("electedOfficials")
    .find({ countryId: fromCountryId, state: regionId })
    .toArray()) as unknown as CarriedOfficial[];

  // Grouped by the office they are LANDING in: the target chamber's size is what
  // the shares are rescaled onto, and two source offices can land in one chamber.
  const byTargetOffice = new Map<string, CarriedOfficial[]>();
  for (const official of officials) {
    const target = remapOffice(fromCountryId, toCountryId, official.officeType);
    if (target === null) {
      await db.collection("electedOfficials").deleteOne({ _id: official._id });
      officialsRetired++;
      continue;
    }
    const group = byTargetOffice.get(target) ?? [];
    group.push(official);
    byTargetOffice.set(target, group);
  }

  for (const [targetOffice, group] of byTargetOffice) {
    // The chamber this region is joining. `totalSeats` is authoritative: it is
    // SEEDED, not derived — Germany's seed already carries `DE-bundestag-SN` and
    // friends precisely so a reunified Bundestag has a sized chamber waiting.
    const seatDoc = (await db
      .collection("seats")
      .findOne({ countryId: toCountryId, state: regionId, electionType: targetOffice })) as {
      totalSeats?: number;
    } | null;

    // An office nobody holds seats in (a governor, a minister-president) has no
    // magnitude to rescale, and apportioning one would invent seats for a seat
    // that is not a seat.
    const carriesSeats = group.some((o) => (o.seatsHeld ?? 0) > 0);
    let allocation: Record<string, number> | null = null;
    if (seatDoc?.totalSeats && carriesSeats) {
      const sourceByParty: Record<string, number> = {};
      for (const o of group) {
        const key = o.party ?? "independent";
        sourceByParty[key] = (sourceByParty[key] ?? 0) + (o.seatsHeld ?? 0);
      }
      allocation = apportionSeats(sourceByParty, seatDoc.totalSeats);
    }

    // Split each party's new allocation across the rows that party holds here.
    // Largest remainder again, keyed by row id, so two officials sharing one
    // delegation split it identically on every run.
    const rowsByParty = new Map<string, CarriedOfficial[]>();
    for (const o of group) {
      const key = o.party ?? "independent";
      const rows = rowsByParty.get(key) ?? [];
      rows.push(o);
      rowsByParty.set(key, rows);
    }

    for (const [party, rows] of rowsByParty) {
      const ordered = [...rows].sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
      const share =
        allocation && allocation[party] !== undefined
          ? apportionSeats(
              Object.fromEntries(ordered.map((o) => [String(o._id), o.seatsHeld ?? 1])),
              allocation[party]
            )
          : null;
      for (const o of ordered) {
        await db.collection("electedOfficials").updateOne(
          { _id: o._id },
          {
            $set: {
              countryId: toCountryId,
              officeType: targetOffice,
              ...(share ? { seatsHeld: share[String(o._id)] ?? 0 } : {}),
              updatedAt: now,
            },
          }
        );
        officialsRemapped++;
      }
    }
  }

  return { officialsRemapped, officialsRetired };
}
