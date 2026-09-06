import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { snapshotApprovalHistory } from "@/lib/utils/governmentApproval";
import {
  belligerentsOf,
  guestsToRelease,
  planApprovalSnapshot,
} from "@/lib/utils/approvalSnapshotTargets";

/**
 * Orchestration for the per-turn approval snapshot: who gets one, and whose
 * document is handed back afterwards.
 *
 * Split out from `governmentApproval.ts` because it is a different job from
 * scoring one country, and because keeping it here lets its own test drive the
 * roster and the release decision with `snapshotApprovalHistory` stubbed out.
 * The bug this file exists to prevent — a guest document left on disk with
 * nothing that could ever remove it — lived in the wiring, not in the pure
 * helpers it calls, and had no test at that level.
 */

export interface ApprovalSnapshotRun {
  /** How many countries were snapshotted this turn. */
  countriesProcessed: number;
  /** Guests whose approval document was released because their war is over. */
  guestsReleased: CountryId[];
}

/**
 * Run the per-turn approval snapshot across every country that needs one.
 *
 * This used to be the `active` countries alone, which left a hole: every country
 * in the game has a reachable approval page backed by full metrics, but a
 * country at war and not yet playable had no `governmentApprovals` document at
 * all. Its war block was therefore computed nowhere and shown nowhere, and its
 * page fell back to the live recompute in `loadNationalApproval` — which by
 * design carries none of the national providers. Both of the non-playable
 * belligerents in the War for Germany sat in exactly that state, each with a
 * scoring war block nobody could see.
 *
 * Guests (belligerents that are not `active`) are released again once their war
 * is over AND their exhaustion has finished healing, which can be many hundreds
 * of turns after the last shot. See `releaseApprovalGuests` for why that matters.
 */
export async function snapshotApprovalsForTurn(db: Db, turn: number): Promise<ApprovalSnapshotRun> {
  const activeIds = COUNTRY_ORDER.filter((id) => COUNTRY_CONFIGS[id].status === "active");
  const approvals = db.collection<GovernmentApproval>("governmentApprovals");

  const [conflicts, documentedDocs, seededStateCountries] = await Promise.all([
    listActiveConflicts(db),
    // Every country that already has an approval document, not merely those with
    // exhaustion left to heal. Two reasons, and the second is the load-bearing
    // one. Exhaustion only moves on a turn the snapshot runs for that country, so
    // a country dropped the moment its war ended would carry its wartime penalty
    // frozen for good; and releasing a guest's document only happens for
    // countries in this set, so a guest that leaves it by any route leaks its
    // document permanently. `planApprovalSnapshot` has the full argument.
    //
    // Cheap: one projection over a collection with one document per country that
    // has ever needed one.
    approvals.find({}, { projection: { _id: 1 } }).toArray(),
    db.collection("states").distinct("countryId"),
  ]);

  const known = (id: unknown): id is CountryId => typeof id === "string" && id in COUNTRY_CONFIGS;
  const belligerents = belligerentsOf(conflicts).filter(known);
  const documented = documentedDocs.map((doc) => doc._id).filter(known);
  const seeded = seededStateCountries.filter(known);

  const plan = planApprovalSnapshot(activeIds, belligerents, documented, seeded);
  await Promise.all(plan.ids.map((id) => snapshotApprovalHistory(db, id, turn)));

  return {
    countriesProcessed: plan.ids.length,
    guestsReleased: await releaseApprovalGuests(db, plan.guests, belligerents),
  };
}

/**
 * Drop the approval documents of guests whose war is finished.
 *
 * `loadNationalApproval` prefers a stored rating over its live recompute
 * unconditionally, and nothing refreshes a non-active country that is not at
 * war — so a document left behind here would pin that country's page to its
 * last wartime number permanently. Releasing it puts the country back exactly
 * where it was before the war: no document, live recompute, the same as every
 * other country at peace.
 *
 * The same argument covers a document some other system (a crisis effect, say)
 * wrote for one of these countries: with no snapshot keeping it current it is
 * stale by construction, and a stale rating is worse than none.
 *
 * Active countries are filtered out a second time even though `plan.guests`
 * already excludes them. This deletes live production documents, and one
 * redundant guard is cheap next to dropping a playable country's history.
 */
async function releaseApprovalGuests(
  db: Db,
  guests: CountryId[],
  belligerents: CountryId[]
): Promise<CountryId[]> {
  if (guests.length === 0) return [];

  const approvals = db.collection<GovernmentApproval>("governmentApprovals");
  const docs = await approvals
    .find({ _id: { $in: guests } }, { projection: { _id: 1, warExhaustion: 1 } })
    .toArray();
  const exhaustion = new Map(docs.map((doc) => [doc._id, doc.warExhaustion ?? 0]));

  const release = guestsToRelease(guests, belligerents, exhaustion).filter(
    (id) => COUNTRY_CONFIGS[id]?.status !== "active"
  );
  if (release.length === 0) return [];

  // Deleting a live document is worth a line in the turn log, so an operator
  // reading back a turn can see why a country's approval page went from a stored
  // rating to a recomputed one.
  console.info(
    `[approvalSnapshot] released approval documents for ${release.join(", ")}: war over, exhaustion healed`
  );
  await approvals.deleteMany({ _id: { $in: release } });
  return release;
}
