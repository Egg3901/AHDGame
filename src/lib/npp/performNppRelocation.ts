import type { Db, ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  NPP,
  State,
  StatePartyOrg,
} from "@/lib/db/types";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { updatePartyPresence } from "@/lib/turn/partyOrg/presence";

export interface NppRelocationOutcome {
  /** Office label the NPP was vacated from, or null if they held none. */
  resignedFromOffice: string | null;
  /** Count of active general-election candidacies withdrawn by the move. */
  withdrawnGeneralElections: number;
  /** Region ids whose `statePartyOrg` presence flag was recomputed. */
  presenceRecountedStates: string[];
  /** Old region's state-party roles the NPP was stripped from ("chair", ...). */
  clearedStateLeadership: string[];
}

/**
 * Vacate the NPP's `electedOfficials` row. An NPP's seat is region-scoped, so a
 * move out of the region must free it — otherwise the roster keeps a politician
 * representing a region they no longer live in.
 */
async function vacateNppOffice(
  db: Db,
  npp: NPP,
  now: Date
): Promise<{ resignedFromOffice: string | null }> {
  const currentOffice = npp.currentOffice;
  if (!currentOffice) return { resignedFromOffice: null };

  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    { nppId: npp._id },
    {
      $set: { isNPP: false, updatedAt: now },
      $unset: { nppId: "", characterName: "", party: "", electedAt: "" },
    }
  );

  if (
    currentOffice.type === "senate" &&
    "senateClass" in currentOffice &&
    currentOffice.senateClass &&
    "state" in currentOffice
  ) {
    await notifyGovernorOfSenateVacancy(db, currentOffice.state, currentOffice.senateClass);
  }

  const officeState = "state" in currentOffice ? currentOffice.state : null;
  return {
    resignedFromOffice: officeState ? `${currentOffice.type} (${officeState})` : currentOffice.type,
  };
}

/**
 * Withdraw every still-open candidacy. A candidacy is tied to a race in the old
 * region, so it cannot survive the move.
 */
async function withdrawNppActiveCandidacies(
  db: Db,
  nppId: ObjectId,
  now: Date
): Promise<{ withdrawnGeneralElections: number }> {
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ nppId, isNPP: true, status: "active" })
    .toArray();

  if (candidacies.length === 0) return { withdrawnGeneralElections: 0 };

  const electionIds = [...new Set(candidacies.map((candidate) => candidate.electionId))];
  const openElections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: electionIds }, status: { $in: ["upcoming", "active", "completed"] } })
    .project({ _id: 1 })
    .toArray();
  const openElectionIds = new Set(openElections.map((election) => election._id.toString()));
  const toWithdraw = candidacies.filter((candidate) =>
    openElectionIds.has(candidate.electionId.toString())
  );

  if (toWithdraw.length === 0) return { withdrawnGeneralElections: 0 };

  await db
    .collection("electionCandidates")
    .updateMany(
      { _id: { $in: toWithdraw.map((candidate) => candidate._id) } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  for (const candidate of toWithdraw) {
    await removeWithdrawnCandidateFromTally(db, candidate.electionId, candidate._id.toString());
  }

  return { withdrawnGeneralElections: toWithdraw.length };
}

/**
 * Strip any state-party office the NPP holds in the region they are leaving.
 * Mirrors step 5 of the player pipeline (`performRelocation`): you cannot chair
 * a region's party organisation from another region.
 */
async function clearOldRegionStateLeadership(
  db: Db,
  npp: NPP,
  oldStateId: string,
  now: Date
): Promise<string[]> {
  if (!npp.party || npp.party === "independent") return [];

  const oldStateOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
    partyId: npp.party,
    stateId: oldStateId,
    $or: [{ chairId: npp._id }, { viceChairId: npp._id }, { treasurerId: npp._id }],
  });
  if (!oldStateOrg) return [];

  const nppIdStr = npp._id.toString();
  const updates: Record<string, unknown> = { updatedAt: now };
  const positions: string[] = [];
  if (oldStateOrg.chairId?.toString() === nppIdStr) {
    updates.chairId = null;
    positions.push("chair");
  }
  if (oldStateOrg.viceChairId?.toString() === nppIdStr) {
    updates.viceChairId = null;
    positions.push("viceChair");
  }
  if (oldStateOrg.treasurerId?.toString() === nppIdStr) {
    updates.treasurerId = null;
    positions.push("treasurer");
  }
  if (positions.length === 0) return [];

  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne({ _id: oldStateOrg._id }, { $set: updates });
  return positions;
}

/**
 * Apply the full relocation pipeline to an NPP — the `npps`-collection sibling of
 * `performRelocation` for player characters.
 *
 * Before this existed, the only NPP move path (`relocate_state` party influence)
 * wrote `homeState` and vacated the office inline, and left every other
 * region-derived fact behind: the old and new regions' `statePartyOrg` presence
 * flags were never recomputed, so moving a party's last NPP out of a region left
 * that region flagged as "party present" (and a region gaining its first NPP
 * stayed flagged empty, blocking Build Org there). State-party leadership in the
 * abandoned region was also retained.
 *
 * Assumes the caller has already validated the target region exists, belongs to
 * the NPP's country, differs from the current region, and has capacity.
 */
export async function performNppRelocation(
  db: Db,
  npp: NPP,
  targetState: State,
  now: Date = new Date()
): Promise<NppRelocationOutcome> {
  const oldStateId = npp.homeState;
  const newStateId = targetState._id;

  const [{ resignedFromOffice }, { withdrawnGeneralElections }] = await Promise.all([
    vacateNppOffice(db, npp, now),
    withdrawNppActiveCandidacies(db, npp._id, now),
  ]);

  const clearedStateLeadership = await clearOldRegionStateLeadership(db, npp, oldStateId, now);

  await db
    .collection<NPP>("npps")
    .updateOne(
      { _id: npp._id },
      { $set: { homeState: newStateId, currentOffice: null, updatedAt: now } }
    );

  // Presence is derived from where a party's NPPs live, so it must be recomputed
  // for BOTH regions, and only after the `homeState` write above lands.
  const presenceRecountedStates: string[] = [];
  if (npp.party && npp.party !== "independent") {
    await updatePartyPresence(db, oldStateId, npp.party);
    await updatePartyPresence(db, newStateId, npp.party);
    presenceRecountedStates.push(oldStateId, newStateId);
  }

  return {
    resignedFromOffice,
    withdrawnGeneralElections,
    presenceRecountedStates,
    clearedStateLeadership,
  };
}

/**
 * Human-readable summary of what a relocation cleaned up, for the action result
 * message the player sees.
 */
export function describeNppRelocationCleanup(outcome: NppRelocationOutcome): string[] {
  const notes: string[] = [];
  if (outcome.resignedFromOffice) notes.push("resigned from office");
  if (outcome.withdrawnGeneralElections > 0) {
    notes.push(
      `withdrew from ${outcome.withdrawnGeneralElections} active election${
        outcome.withdrawnGeneralElections === 1 ? "" : "s"
      }`
    );
  }
  if (outcome.clearedStateLeadership.length > 0) {
    notes.push(`stood down as ${outcome.clearedStateLeadership.join(", ")}`);
  }
  return notes;
}
