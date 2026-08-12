import type { Db, ObjectId } from "mongodb";
import { resolveBillVoteField } from "@/lib/congress/billVoteField";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import type { CountryId } from "@/lib/constants/countries";
import type { Bill, CabinetNomination, ElectedOfficial, SpeakerNomination } from "@/lib/db/types";
import {
  getPMAppointmentVotesCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";

export interface PlayerWhipResult {
  /** Number of characters whose votes were overwritten (did not already match). */
  overridden: number;
  /** Number of characters whose existing vote already matched the whip direction. */
  alreadyAligned: number;
}

/**
 * Overwrite each eligible character's vote on a bill with the whip direction.
 * Snapshots the pre-whip value into whippedFromVote.<characterId>; "unvoted"
 * when the character had not previously voted. Updates tallies to preserve
 * the vote totals invariant.
 *
 * Chamber-aware: writes to otherChamberVotes / vetoOverrideVotes when the
 * bill status indicates the active chamber, matching applyWhipVotesToBill.
 */
export async function applyPlayerWhipToBill(
  db: Db,
  bill: Bill,
  direction: "for" | "against",
  eligibleCharacterIds: ObjectId[]
): Promise<PlayerWhipResult> {
  if (eligibleCharacterIds.length === 0) {
    return { overridden: 0, alreadyAligned: 0 };
  }

  const isOtherChamber = bill.status === "active_other";
  const isOverride = bill.status === "veto_override";

  const voteField = isOtherChamber
    ? "otherChamberVotes"
    : isOverride
      ? "vetoOverrideVotes"
      : "votes";
  const snapshotField = isOtherChamber
    ? "otherChamberWhippedFromVote"
    : isOverride
      ? "vetoOverrideWhippedFromVote"
      : "whippedFromVote";

  const existingVotes =
    (isOtherChamber ? bill.otherChamberVotes : isOverride ? bill.vetoOverrideVotes : bill.votes) ??
    {};

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { characterId: { $in: eligibleCharacterIds } },
      { projection: { characterId: 1, seatsHeld: 1, officeType: 1 } }
    )
    .toArray();
  const weightByCharId = new Map<string, number>(
    officials
      .filter((o) => o.characterId != null)
      .map((o) => [o.characterId!.toString(), o.seatsHeld ?? 1])
  );
  const officeTypeByCharId = new Map<string, string>(
    officials
      .filter((o) => o.characterId != null)
      .map((o) => [o.characterId!.toString(), o.officeType])
  );

  /**
   * On a CONCURRENT bill the four forks above are per-MEMBER, not per-bill.
   *
   * Whipping an upper-chamber member through the lower branch writes their vote AND
   * their weight into the lower chamber's map and tally — so the bill can PASS on votes
   * cast by the other house. That is worse than the fail-closed cases elsewhere in this
   * change, because nothing looks wrong.
   *
   * The lower chamber is the bill's origin chamber; every other seated office type on a
   * concurrent bill is the upper one.
   */
  const isConcurrent = bill.status === "active_both";
  const lowerOfficeType = isConcurrent
    ? getOfficeTypeForChamber(
        (bill.countryId ?? "US") as CountryId,
        bill.originChamber === "joint" ? (bill.currentChamber ?? "") : bill.originChamber
      )
    : "";

  const routeFor = (key: string) => {
    if (!isConcurrent) {
      return { field: voteField, snapshot: snapshotField, existing: existingVotes };
    }
    const field = resolveBillVoteField(bill, {
      voterOfficeType: officeTypeByCharId.get(key),
      lowerOfficeType,
    });
    return field === "otherChamberVotes"
      ? {
          field,
          snapshot: "otherChamberWhippedFromVote",
          existing: bill.otherChamberVotes ?? {},
        }
      : { field, snapshot: "whippedFromVote", existing: bill.votes ?? {} };
  };

  /** Per-field net deltas — one bucket for every non-concurrent status. */
  const net = new Map<string, { f: number; a: number; ab: number }>();
  const netOf = (field: string) => {
    let n = net.get(field);
    if (!n) {
      n = { f: 0, a: 0, ab: 0 };
      net.set(field, n);
    }
    return n;
  };

  let overridden = 0;
  let alreadyAligned = 0;

  const setFields: Record<string, unknown> = { updatedAt: new Date() };

  for (const charId of eligibleCharacterIds) {
    const key = charId.toString();
    const route = routeFor(key);
    const previous = route.existing[key];
    const snapshot: "for" | "against" | "abstain" | "unvoted" = previous ?? "unvoted";

    setFields[`${route.snapshot}.${key}`] = snapshot;
    setFields[`${route.field}.${key}`] = direction;

    if (previous === direction) {
      alreadyAligned++;
      continue;
    }
    overridden++;

    const weight = weightByCharId.get(key) ?? 1;
    const n = netOf(route.field);

    if (previous === "for") n.f -= weight;
    else if (previous === "against") n.a -= weight;
    else if (previous === "abstain") n.ab -= weight;

    if (direction === "for") n.f += weight;
    else n.a += weight;
  }

  /** Counter names per vote field. Override carries no abstain counter. */
  const TALLY: Record<string, [string, string, string | null]> = {
    votes: ["votesFor", "votesAgainst", "votesAbstain"],
    otherChamberVotes: [
      "otherChamberVotesFor",
      "otherChamberVotesAgainst",
      "otherChamberVotesAbstain",
    ],
    vetoOverrideVotes: ["vetoOverrideVotesFor", "vetoOverrideVotesAgainst", null],
  };

  const incFields: Record<string, number> = {};
  for (const [field, n] of net) {
    const [forKey, againstKey, abstainKey] = TALLY[field]!;
    if (n.f !== 0) incFields[forKey] = n.f;
    if (n.a !== 0) incFields[againstKey] = n.a;
    if (abstainKey && n.ab !== 0) incFields[abstainKey] = n.ab;
  }

  await db
    .collection<Bill>("bills")
    .updateOne(
      { _id: bill._id },
      Object.keys(incFields).length > 0 ? { $set: setFields, $inc: incFields } : { $set: setFields }
    );

  return { overridden, alreadyAligned };
}

/**
 * Force-cast votes for each eligible character on a leadership/speaker nomination.
 * Snapshots into whippedFromVote.<characterId>:
 *   - existing vote for a DIFFERENT candidate → snapshot is that candidate's ObjectId string
 *   - existing vote for THIS candidate       → snapshot is "for" (revert no-ops)
 *   - no prior vote                          → snapshot is "unvoted"
 *
 * House/Senate leadership nominations share one collection across roles. Re-votes
 * are scoped to the target's role so whipping Majority Whip cannot steal votes
 * from Pro Tempore / Majority Leader (ticket #1046).
 */
export async function applyPlayerWhipToLeadership(
  db: Db,
  targetCandidacyId: ObjectId,
  nominationCollection: string,
  eligibleCharacterIds: ObjectId[]
): Promise<PlayerWhipResult> {
  if (eligibleCharacterIds.length === 0) {
    return { overridden: 0, alreadyAligned: 0 };
  }

  const openNominations = await db
    .collection<SpeakerNomination>(nominationCollection)
    .find({ status: { $in: ["open", "voting"] } })
    .toArray();

  const target = openNominations.find((n) => n._id.equals(targetCandidacyId));
  if (!target) return { overridden: 0, alreadyAligned: 0 };

  const targetRole = (target as SpeakerNomination & { role?: string }).role;
  const raceNominations =
    typeof targetRole === "string"
      ? openNominations.filter(
          (n) => (n as SpeakerNomination & { role?: string }).role === targetRole
        )
      : openNominations;

  const officeType = nominationCollection === "senateLeadershipNominations" ? "senate" : "house";
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { characterId: { $in: eligibleCharacterIds }, officeType, countryId: "US" },
      { projection: { characterId: 1, seatsHeld: 1 } }
    )
    .toArray();
  const weightByCharId = new Map<string, number>(
    officials
      .filter((o) => o.characterId != null)
      .map((o) => [o.characterId!.toString(), o.seatsHeld ?? 1])
  );

  const now = new Date();
  let overridden = 0;
  let alreadyAligned = 0;

  const setFields: Record<string, unknown> = { updatedAt: now, status: "voting" };
  let incFor = 0;

  for (const charId of eligibleCharacterIds) {
    const key = charId.toString();
    const weight = weightByCharId.get(key) ?? 1;

    if (target.votes?.[key]) {
      // Already voting for this candidate — snapshot their current value so revert is a no-op
      setFields[`whippedFromVote.${key}`] = "for";
      alreadyAligned++;
      continue;
    }

    const previousNom = raceNominations.find(
      (n) => !n._id.equals(targetCandidacyId) && n.votes?.[key]
    );

    const snapshotValue = previousNom ? previousNom._id.toString() : "unvoted";
    setFields[`whippedFromVote.${key}`] = snapshotValue;
    setFields[`votes.${key}`] = "for";
    incFor += weight;
    overridden++;

    if (previousNom) {
      await db.collection(nominationCollection).updateOne(
        { _id: previousNom._id },
        {
          $unset: {
            [`votes.${key}`]: "",
            [`whippedFromVote.${key}`]: "",
          },
          $inc: { votesFor: -weight },
          $set: { updatedAt: now },
        }
      );
    }
  }

  await db
    .collection<SpeakerNomination>(nominationCollection)
    .updateOne(
      { _id: target._id },
      incFor > 0 ? { $set: setFields, $inc: { votesFor: incFor } } : { $set: setFields }
    );

  return { overridden, alreadyAligned };
}

/**
 * Force-cast aye/nay votes on PM-appointment or no-confidence vote docs.
 * Whip "for" maps to "aye"; "against" maps to "nay". Snapshots the prior
 * vote as "for"/"against"/"unvoted" (using the underlying vote semantics
 * so the UI can show the revert affordance consistently with bills).
 */
export async function applyPlayerWhipToGovernmentVote(
  db: Db,
  voteId: ObjectId,
  targetType: "pmAppointmentVote" | "noConfidenceVote",
  direction: "for" | "against",
  eligibleCharacterIds: ObjectId[]
): Promise<PlayerWhipResult> {
  if (eligibleCharacterIds.length === 0) {
    return { overridden: 0, alreadyAligned: 0 };
  }

  const coll =
    targetType === "pmAppointmentVote"
      ? getPMAppointmentVotesCollection(db)
      : getNoConfidenceVotesCollection(db);

  const doc = await coll.findOne({ _id: voteId });
  if (!doc || doc.status !== "active") {
    return { overridden: 0, alreadyAligned: 0 };
  }

  // Look up seat weights — same as applyWhipVotesToGovernmentVote does for NPPs.
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { characterId: { $in: eligibleCharacterIds } },
      { projection: { characterId: 1, seatsHeld: 1 } }
    )
    .toArray();
  const weightByCharId = new Map<string, number>(
    officials
      .filter((o) => o.characterId != null)
      .map((o) => [o.characterId!.toString(), o.seatsHeld ?? 1])
  );

  const voteChoice: "aye" | "nay" = direction === "for" ? "aye" : "nay";
  const existing = doc.votes ?? {};
  const now = new Date();

  let overridden = 0;
  let alreadyAligned = 0;
  let incFor = 0;
  let incAgainst = 0;
  let decFor = 0;
  let decAgainst = 0;

  const setFields: Record<string, unknown> = { updatedAt: now };

  for (const charId of eligibleCharacterIds) {
    const key = charId.toString();
    const prev = existing[key] as "aye" | "nay" | undefined;

    // Snapshot in bill-vote semantics so UI is consistent across target types
    let snapshot: "for" | "against" | "unvoted";
    if (prev === "aye") snapshot = "for";
    else if (prev === "nay") snapshot = "against";
    else snapshot = "unvoted";

    setFields[`whippedFromVote.${key}`] = snapshot;
    setFields[`votes.${key}`] = voteChoice;

    if (prev === voteChoice) {
      alreadyAligned++;
      continue;
    }
    overridden++;

    const weight = weightByCharId.get(key) ?? 1;

    if (prev === "aye") decFor += weight;
    else if (prev === "nay") decAgainst += weight;

    if (voteChoice === "aye") incFor += weight;
    else incAgainst += weight;
  }

  const netFor = incFor - decFor;
  const netAgainst = incAgainst - decAgainst;
  const incFields: Record<string, number> = {};
  if (netFor !== 0) incFields.votesFor = netFor;
  if (netAgainst !== 0) incFields.votesAgainst = netAgainst;

  await coll.updateOne(
    { _id: voteId },
    Object.keys(incFields).length > 0 ? { $set: setFields, $inc: incFields } : { $set: setFields }
  );

  return { overridden, alreadyAligned };
}

/**
 * Force-cast for/against votes on a cabinet nomination. Same snapshot
 * semantics as applyPlayerWhipToBill (for/against/abstain/unvoted).
 */
export async function applyPlayerWhipToCabinet(
  db: Db,
  nominationId: ObjectId,
  direction: "for" | "against",
  eligibleCharacterIds: ObjectId[]
): Promise<PlayerWhipResult> {
  if (eligibleCharacterIds.length === 0) {
    return { overridden: 0, alreadyAligned: 0 };
  }

  const nomination = await db
    .collection<CabinetNomination>("cabinetNominations")
    .findOne({ _id: nominationId });
  if (!nomination || nomination.status !== "active") {
    return { overridden: 0, alreadyAligned: 0 };
  }

  const existing = nomination.votes ?? {};
  const now = new Date();

  let overridden = 0;
  let alreadyAligned = 0;
  let incFor = 0;
  let incAgainst = 0;
  let decFor = 0;
  let decAgainst = 0;

  const setFields: Record<string, unknown> = { updatedAt: now };

  for (const charId of eligibleCharacterIds) {
    const key = charId.toString();
    const prev = existing[key] as "for" | "against" | "abstain" | undefined;
    const snapshot: "for" | "against" | "abstain" | "unvoted" = prev ?? "unvoted";

    setFields[`whippedFromVote.${key}`] = snapshot;
    setFields[`votes.${key}`] = direction;

    if (prev === direction) {
      alreadyAligned++;
      continue;
    }
    overridden++;

    if (prev === "for") decFor++;
    else if (prev === "against") decAgainst++;

    if (direction === "for") incFor++;
    else incAgainst++;
  }

  const netFor = incFor - decFor;
  const netAgainst = incAgainst - decAgainst;
  const incFields: Record<string, number> = {};
  if (netFor !== 0) incFields.votesFor = netFor;
  if (netAgainst !== 0) incFields.votesAgainst = netAgainst;

  await db
    .collection<CabinetNomination>("cabinetNominations")
    .updateOne(
      { _id: nominationId },
      Object.keys(incFields).length > 0 ? { $set: setFields, $inc: incFields } : { $set: setFields }
    );

  return { overridden, alreadyAligned };
}
