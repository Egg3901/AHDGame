import { type Db } from "mongodb";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import {
  getOrSeedPartyLeadership,
  historyEntry,
  pushHistoryEntry,
} from "@/lib/uk/leadership/leadershipStore";
import { getUKPartyLeadershipCollection } from "@/lib/db/collections/ukPartyLeadership";
import {
  LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
  validateRulesetAmendment,
} from "@/lib/uk/leadership/rules";
import { resolveConferenceMotion, resolvePlatformRatification } from "@/lib/uk/conference/rules";
import { conferenceHistoryEntry, pushConferenceHistory } from "@/lib/uk/conference/conferenceStore";
import type {
  ConferenceHistoryEntry,
  ConferenceRulesMotion,
  UKPartyConference,
} from "@/lib/uk/conference/types";
import type { PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  partySeqIdOf,
  frozenRollOf,
  countPartyMembers,
  ensureEligibleRoll,
} from "./conferenceShared";

/**
 * Receipt/void crash-concurrency contract (ticket #862 follow-up). A motion
 * marked void while its leadership receipt exists is a mislabel: the winning
 * applier created the receipt after this pass's last confirmation read and
 * crashed before marking. Completed receipts dominate voids
 * deterministically:
 *
 * - the mark-time recheck in computeReconcileDecisions flips any void whose
 *   receipt landed during the pass, so the mark write never stamps void over
 *   a receipt it could have seen;
 * - a race-path void (CONFERENCE_RACE_VOID_REASON) stays heal-owed through
 *   conferenceResolutionNeedsHeal, so the turn driver self-revisits the row
 *   on the next tick without an explicit resolve call;
 * - the revisit confirms the void terminal (CONFERENCE_RACE_VOID_CONFIRMED)
 *   when the receipt is still absent, so retries are bounded: at most one
 *   follow-up pass per race void, then the row is quiet.
 *
 * Cooldown and validation voids are terminal at mark time. A cooldown void
 * implies the receipt was absent at the final check and no concurrent
 * same-motion apply could have succeeded under the active cooldown; a
 * validation void's patch could never have landed a receipt.
 */
export const CONFERENCE_RACE_VOID_REASON =
  "void: concurrent leadership-rules amendment won the cooldown race";
export const CONFERENCE_RACE_VOID_CONFIRMED = `${CONFERENCE_RACE_VOID_REASON} (confirmed: no effect applied)`;

export async function applyPassedMotion(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  leadershipId: string,
  motion: ConferenceRulesMotion,
  currentTurn: number,
  now: Date
): Promise<{ applied: boolean; voidReason: string | null }> {
  const collection = getUKPartyLeadershipCollection(db);
  // Durable serialization contract for distinct motions (ticket #862
  // follow-up). Two reconcilers must not both pass a stale cooldown check and
  // land mutually invalid patches, while retries of the same motion stay
  // exactly-once:
  //
  // - Same motion: the motion receipt (`appliedConferenceMotionIds`, guarded
  //   by `$ne` in the write filter) makes replays and concurrent appliers of
  //   the SAME motion converge on applied without a second write.
  // - Distinct motions: the cooldown travels WITH the write as a
  //   compare-and-swap on the observed `lastAmendedTurn`. The first writer
  //   moves it to the current turn, so every later distinct writer misses its
  //   filter and voids on re-read instead of landing a second patch inside
  //   the window. `{ lastAmendedTurn: null }` matches null AND missing, so a
  //   legacy row without the field satisfies the first amendment.
  // - A void is returned only after confirming the receipt is still absent: a
  //   concurrent winner may have applied THIS motion between our read and our
  //   decision, and that must report applied, never void.
  for (let attempt = 0; attempt < 2; attempt++) {
    const leadership = await getOrSeedPartyLeadership(db, countryId, party, now, currentTurn);
    if ((leadership.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
      // Replay guard: the effect is already durable, so there is nothing to
      // re-apply. The write below is conditional on the same receipt, so even
      // a concurrent caller that passed this check cannot double-apply.
      return { applied: true, voidReason: null };
    }
    if (!Array.isArray(leadership.appliedConferenceMotionIds)) {
      // Pre-receipt leadership row: create the receipt array before the
      // conditional write below needs it. Idempotent; real Mongo would also
      // create it via $push, but the test stand-in requires the array.
      await collection.updateOne(
        { _id: leadershipId },
        { $set: { appliedConferenceMotionIds: [], updatedAt: now } }
      );
    }
    const observedAmendTurn = leadership.lastAmendedTurn ?? null;
    const sinceAmend = observedAmendTurn == null ? undefined : currentTurn - observedAmendTurn;
    if (sinceAmend !== undefined && sinceAmend < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
      const current = await collection.findOne({ _id: leadershipId });
      if ((current?.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
        return { applied: true, voidReason: null };
      }
      const sinceCurrent =
        current?.lastAmendedTurn == null ? undefined : currentTurn - current.lastAmendedTurn;
      if (sinceCurrent !== undefined && sinceCurrent < LEADERSHIP_AMENDMENT_COOLDOWN_TURNS) {
        return {
          applied: false,
          voidReason: `void: rules amended ${sinceCurrent} turn(s) ago, cooldown is ${LEADERSHIP_AMENDMENT_COOLDOWN_TURNS}`,
        };
      }
      // The cooldown lifted under us (a cross-turn stale read): retry once
      // from the fresh state instead of voiding or applying blind.
      continue;
    }
    const validation = validateRulesetAmendment(motion.patch);
    if (!validation.ok) {
      return { applied: false, voidReason: `void: ${validation.errors.join("; ")}` };
    }
    const ruleset = { ...leadership.ruleset, ...motion.patch };
    // Effect + receipt in ONE conditional write: the ruleset patch, the audit
    // entry, and the motion receipt land together or not at all; the $ne
    // guard makes a same-motion replay match zero documents, and the
    // lastAmendedTurn predicate makes a distinct-motion loser miss.
    const write = await collection.updateOne(
      {
        _id: leadershipId,
        appliedConferenceMotionIds: { $ne: motion.motionId },
        lastAmendedTurn: observedAmendTurn,
      },
      {
        $set: {
          ruleset,
          lastAmendedTurn: currentTurn,
          lastAmendedByCharacterId: motion.proposedByCharacterId,
          history: pushHistoryEntry(
            leadership.history,
            historyEntry(
              currentTurn,
              "rulesAmended",
              `Conference motion carried: committee amended removal rules (${motion.motionId})`,
              { characterId: motion.proposedByCharacterId, actorName: motion.proposedByName }
            )
          ),
          updatedAt: now,
        },
        $push: { appliedConferenceMotionIds: motion.motionId },
      }
    );
    if (write.matchedCount === 1) {
      recordAudit({
        source: "turn",
        category: "party",
        action: "uk.conference.motionApplied",
        outcome: "ok",
        subject: { type: "party", id: partySeqIdOf(party), name: party.name },
        meta: { motionId: motion.motionId, patch: motion.patch },
      });
      return { applied: true, voidReason: null };
    }
    // Miss: a concurrent writer moved the receipt or the cooldown first. The
    // loop re-reads fresh: a same-motion receipt reports applied, an active
    // cooldown voids, a lifted cooldown retries the write once.
  }
  // Two misses with no stable classification: writers are racing every
  // attempt. Confirm the receipt one last time so a completed apply is never
  // mislabeled, then void deterministically instead of spinning.
  const current = await collection.findOne({ _id: leadershipId });
  if ((current?.appliedConferenceMotionIds ?? []).includes(motion.motionId)) {
    return { applied: true, voidReason: null };
  }
  return {
    applied: false,
    voidReason: CONFERENCE_RACE_VOID_REASON,
  };
}

export interface ConferenceResolution {
  completed: boolean;
  ratified: boolean;
  motionsPassed: number;
  motionsVoided: number;
}

/**
 * Pure in-memory gate: does a completed row still owe resolution side
 * effects (standing-platform write or motion applications)? Lets the turn
 * driver heal crashed rows without extra reads.
 */
export function conferenceResolutionNeedsHeal(doc: UKPartyConference): boolean {
  if (doc.status !== "completed" || doc.outcome == null) return false;
  if (doc.ratified && doc.platformAppliedTurn == null) return true;
  const applied = new Set(doc.appliedMotionIds ?? []);
  if (
    (doc.motions ?? []).some(
      (motion) =>
        motion.status === "voting" || (motion.status === "passed" && !applied.has(motion.motionId))
    )
  ) {
    return true;
  }
  // A pending race-path void still owes one receipt-confirming revisit: the
  // winning applier may have created the receipt after this row's last
  // confirmation read and crashed before marking. The revisit adopts the
  // receipt (passed) or confirms the void terminal, so it runs at most once.
  return (doc.motions ?? []).some(
    (motion) =>
      motion.status === "void" &&
      motion.voidReason === CONFERENCE_RACE_VOID_REASON &&
      !applied.has(motion.motionId)
  );
}

/** Committee-vote decision for one motion, shared by fill and reconcile. */
function decideMotionVote(
  motion: ConferenceRulesMotion,
  committeeSize: number,
  isNpp: boolean
): { votesFor: number; votesAgainst: number; passed: boolean; reason: string } {
  let votesFor = motion.votesFor;
  const votesAgainst = motion.votesAgainst;
  if (isNpp && votesFor + votesAgainst === 0) {
    // Deterministic NPP committee: a valid tabled motion carries.
    votesFor = Math.max(1, committeeSize);
  }
  const result = resolveConferenceMotion({ votesFor, votesAgainst, eligibleCount: committeeSize });
  return { votesFor, votesAgainst, passed: result.passed, reason: result.reason };
}

/**
 * Fill a claimed-but-unresolved row: decide the platform vote and every
 * motion vote from the frozen snapshot, then persist the whole decision in
 * ONE guarded write. The outcome-null guard elects exactly one filler, so
 * concurrent callers and crash resumes converge instead of double-filling.
 * No cross-collection side effects happen here; those reconcile afterwards.
 */
export async function fillConferenceResolution(
  db: Db,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<{ won: boolean; doc: UKPartyConference }> {
  const isNpp = !party.chairId;
  // Quorum decides from the frozen roll, never from live membership: joins
  // after the freeze cannot inflate the bar and removals cannot shrink it.
  // A legacy row that never froze freezes here, during the fill; only a
  // freeze that cannot persist falls back to live counts for this decision.
  const roll = await ensureEligibleRoll(db, party, doc, now);
  const memberCount = roll.persisted ? roll.memberIds.length : await countPartyMembers(db, party);
  const committeeSize = roll.persisted ? roll.committeeIds.length : getEligibleVoterSet(party).size;
  let ratified = false;
  let proposal = doc.proposal;
  const history = [...(doc.history ?? [])];
  if (proposal && proposal.status === "voting") {
    if (isNpp && proposal.votesFor + proposal.votesAgainst === 0) {
      // AI-run parties acclaim a valid tabled platform: deterministic, no rng.
      proposal = { ...proposal, status: "ratified", resolvedAtTurn: currentTurn };
      ratified = true;
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          "platformRatified",
          "Conference acclaimed the standing platform (AI-run party)"
        )
      );
    } else {
      const result = resolvePlatformRatification({
        votesFor: proposal.votesFor,
        votesAgainst: proposal.votesAgainst,
        eligibleCount: memberCount,
      });
      proposal = {
        ...proposal,
        status: result.passed ? "ratified" : "rejected",
        resolvedAtTurn: currentTurn,
      };
      ratified = result.passed;
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          result.passed ? "platformRatified" : "platformRejected",
          result.passed
            ? `Conference ratified the standing platform (${proposal.votesFor} ratify, ${proposal.votesAgainst} reject)`
            : `Conference rejected the standing platform: ${result.reason}`
        )
      );
    }
  }

  const motions = (doc.motions ?? []).map((motion) => {
    if (motion.status !== "voting") return motion;
    const decided = decideMotionVote(motion, committeeSize, isNpp);
    if (!decided.passed) {
      history.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionFailed",
          `Conference motion ${motion.motionId} failed: ${decided.reason}`
        )
      );
      return {
        ...motion,
        votesFor: decided.votesFor,
        votesAgainst: decided.votesAgainst,
        status: "failed" as const,
        resolvedAtTurn: currentTurn,
      };
    }
    // Tentatively passed: the vote carried, the leadership-ruleset write
    // reconciles afterwards against the motion receipt.
    return {
      ...motion,
      votesFor: decided.votesFor,
      votesAgainst: decided.votesAgainst,
      status: "passed" as const,
      resolvedAtTurn: currentTurn,
    };
  });

  const outcome = ratified ? "ratified" : "closedWithoutRatification";
  const filled = await getUKPartyConferencesCollection(db).findOneAndUpdate(
    { _id: doc._id, status: "completed", outcome: null },
    {
      $set: {
        proposal,
        motions,
        ratified,
        outcome,
        payoffDue: ratified,
        history: pushConferenceHistory(
          history,
          conferenceHistoryEntry(
            currentTurn,
            "completed",
            ratified
              ? "Conference completed: platform ratified, motions reconciling"
              : "Conference completed without ratifying a platform: no payoff"
          )
        ),
        updatedAt: now,
      },
    },
    { returnDocument: "after" }
  );
  return filled ? { won: true, doc: filled } : { won: false, doc };
}

/**
 * A void mark must never durably cover a completed effect. A motion marked
 * void while its leadership receipt exists means the receipt landed after
 * this caller confirmed it absent (a concurrent applier won, or won then
 * crashed before marking): adopt the receipt and mark the motion passed so
 * the next mark write converges instead of cementing the mislabel. Voids
 * with no receipt pass through untouched, so terminal voids stay terminal.
 * Skips the read entirely when the row holds no void motions.
 */
async function adoptReceiptedVoids(
  db: Db,
  countryId: CountryId,
  partySeqId: string,
  working: UKPartyConference
): Promise<UKPartyConference> {
  const voids = (working.motions ?? []).filter((motion) => motion.status === "void");
  if (voids.length === 0) return working;
  const leadership = await getUKPartyLeadershipCollection(db).findOne({
    _id: `${countryId}:${partySeqId}`,
  });
  const receipts = new Set(leadership?.appliedConferenceMotionIds ?? []);
  if (!voids.some((motion) => receipts.has(motion.motionId))) return working;
  return {
    ...working,
    motions: (working.motions ?? []).map((motion) =>
      motion.status === "void" && receipts.has(motion.motionId)
        ? { ...motion, status: "passed" as const, voidReason: null }
        : motion
    ),
  };
}

interface ReconcileDecisions {
  platformAppliedTurn: number | null;
  motions: ConferenceRulesMotion[];
  applied: Set<string>;
  newEntries: ConferenceHistoryEntry[];
  motionsPassed: number;
  motionsVoided: number;
}

/**
 * Compute one reconcile pass over a decided row: the standing-platform
 * upsert (idempotent by key, confirmed via the platform receipt) and each
 * passed motion's leadership write (exactly-once via the motion receipt in
 * the conditional apply). Motion votes are decided first; counts and history
 * are built after the mark-time receipt recheck below, so a receipt that
 * landed mid-pass dominates the void it raced. The caller persists the marks.
 */
async function computeReconcileDecisions(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  partySeqId: string,
  isNpp: boolean,
  working: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<ReconcileDecisions> {
  // Leftover voting motions on healed rows decide from the same frozen roll
  // the fill used; legacy rows without one fall back to live counts.
  const frozen = frozenRollOf(working);
  const committeeSize =
    frozen != null ? frozen.committeeIds.length : getEligibleVoterSet(party).size;

  let platformAppliedTurn = working.platformAppliedTurn ?? null;
  if (working.ratified && platformAppliedTurn == null) {
    if (!working.proposal) {
      // Decided ratified with no proposal to write: nothing exists to
      // persist, so mark it rather than retrying forever.
      platformAppliedTurn = currentTurn;
    } else {
      const key = `${countryId}:${partySeqId}`;
      const existing = await getUKPartyPlatformsCollection(db).findOne({ _id: key });
      if (existing?.ratifiedConferenceId === working._id) {
        platformAppliedTurn = currentTurn;
      } else {
        await getUKPartyPlatformsCollection(db).updateOne(
          { _id: key },
          {
            $set: {
              countryId,
              partyId: partySeqId,
              pledgeIds: [...working.proposal.pledgeIds],
              ratifiedConferenceId: working._id,
              ratifiedYear: working.conferenceYear,
              ratifiedAtTurn: currentTurn,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true }
        );
        platformAppliedTurn = currentTurn;
      }
    }
  }

  const applied = new Set(working.appliedMotionIds ?? []);
  type MotionOutcome =
    | { kind: "carried"; motion: ConferenceRulesMotion }
    | { kind: "replayed"; motion: ConferenceRulesMotion }
    | { kind: "failed"; motion: ConferenceRulesMotion; reason: string }
    | { kind: "applied"; motion: ConferenceRulesMotion }
    | { kind: "voided"; motion: ConferenceRulesMotion; voidReason: string };
  const outcomes: MotionOutcome[] = await Promise.all(
    (working.motions ?? []).map(async (motion): Promise<MotionOutcome> => {
      let current = motion;
      if (current.status === "voting") {
        // Leftover from a row decided before vote outcomes were persisted:
        // decide it now from the frozen votes instead of stranding it.
        const decided = decideMotionVote(current, committeeSize, isNpp);
        if (!decided.passed) {
          return {
            kind: "failed",
            motion: {
              ...current,
              votesFor: decided.votesFor,
              votesAgainst: decided.votesAgainst,
              status: "failed" as const,
              resolvedAtTurn: currentTurn,
            },
            reason: decided.reason,
          };
        }
        current = {
          ...current,
          votesFor: decided.votesFor,
          votesAgainst: decided.votesAgainst,
          status: "passed" as const,
          resolvedAtTurn: currentTurn,
        };
      }
      if (current.status !== "passed") return { kind: "carried", motion: current };
      if (applied.has(current.motionId)) return { kind: "replayed", motion: current };
      const result = await applyPassedMotion(
        db,
        countryId,
        party,
        `${countryId}:${partySeqId}`,
        current,
        currentTurn,
        now
      );
      if (result.applied) return { kind: "applied", motion: current };
      return {
        kind: "voided",
        motion: {
          ...current,
          status: "void" as const,
          voidReason: result.voidReason,
          resolvedAtTurn: currentTurn,
        },
        voidReason: result.voidReason ?? "void: unknown reason",
      };
    })
  );

  // Mark-time receipt recheck: a winning applier may have created a receipt
  // after this pass's last confirmation read (and crashed before marking).
  // Re-read the receipts once, before the caller stamps the marks, so a
  // completed receipt dominates the void it raced instead of being cemented
  // under it. Voids already pending from a previous pass get their one
  // bounded revisit here: receipted ones flip to passed, still-absent ones
  // confirm terminal. Skipped entirely when no void is in play.
  const pendingBefore = new Set(
    (working.motions ?? [])
      .filter(
        (motion) => motion.status === "void" && motion.voidReason === CONFERENCE_RACE_VOID_REASON
      )
      .map((motion) => motion.motionId)
  );
  const needsRecheck =
    pendingBefore.size > 0 ||
    outcomes.some(
      (outcome) =>
        outcome.kind === "voided" ||
        (outcome.kind === "carried" &&
          outcome.motion.status === "void" &&
          outcome.motion.voidReason === CONFERENCE_RACE_VOID_REASON)
    );
  let receipts = new Set<string>();
  if (needsRecheck) {
    const leadership = await getUKPartyLeadershipCollection(db).findOne({
      _id: `${countryId}:${partySeqId}`,
    });
    receipts = new Set(leadership?.appliedConferenceMotionIds ?? []);
  }

  let motionsPassed = 0;
  let motionsVoided = 0;
  const newEntries: ConferenceHistoryEntry[] = [];
  const passedEntry = (motion: ConferenceRulesMotion): ConferenceHistoryEntry =>
    conferenceHistoryEntry(
      currentTurn,
      "motionPassed",
      `Conference motion ${motion.motionId} passed and amended leadership rules ` +
        `(${motion.votesFor} for, ${motion.votesAgainst} against)`,
      { characterId: motion.proposedByCharacterId, actorName: motion.proposedByName },
      now
    );
  const motions: ConferenceRulesMotion[] = [];
  // A void dominated by a completed receipt: adopt the receipt and mark the
  // motion passed so the mark write converges instead of mislabeling.
  const adoptVoid = (motion: ConferenceRulesMotion): ConferenceRulesMotion => ({
    ...motion,
    status: "passed" as const,
    voidReason: null,
  });
  for (const outcome of outcomes) {
    if (outcome.kind === "carried") {
      const motion = outcome.motion;
      if (motion.status === "void" && motion.voidReason === CONFERENCE_RACE_VOID_REASON) {
        if (receipts.has(motion.motionId)) {
          motionsPassed += 1;
          applied.add(motion.motionId);
          newEntries.push(passedEntry(adoptVoid(motion)));
          motions.push(adoptVoid(motion));
        } else {
          // A carried pending void is always in pendingBefore (it came from
          // the durable row), so this is its one bounded revisit: still no
          // receipt, confirm it terminal. The row goes quiet afterwards.
          motionsVoided += 1;
          newEntries.push(
            conferenceHistoryEntry(
              currentTurn,
              "motionVoided",
              `Conference motion ${motion.motionId} confirmed ${CONFERENCE_RACE_VOID_CONFIRMED}`,
              undefined,
              now
            )
          );
          motions.push({ ...motion, voidReason: CONFERENCE_RACE_VOID_CONFIRMED });
        }
      } else {
        motions.push(motion);
      }
      continue;
    }
    if (outcome.kind === "replayed") {
      motionsPassed += 1;
      motions.push(outcome.motion);
      continue;
    }
    if (outcome.kind === "failed") {
      newEntries.push(
        conferenceHistoryEntry(
          currentTurn,
          "motionFailed",
          `Conference motion ${outcome.motion.motionId} failed: ${outcome.reason}`,
          undefined,
          now
        )
      );
      motions.push(outcome.motion);
      continue;
    }
    if (outcome.kind === "applied") {
      motionsPassed += 1;
      applied.add(outcome.motion.motionId);
      newEntries.push(passedEntry(outcome.motion));
      motions.push(outcome.motion);
      continue;
    }
    if (receipts.has(outcome.motion.motionId)) {
      motionsPassed += 1;
      applied.add(outcome.motion.motionId);
      newEntries.push(passedEntry(adoptVoid(outcome.motion)));
      motions.push(adoptVoid(outcome.motion));
      continue;
    }
    motionsVoided += 1;
    newEntries.push(
      conferenceHistoryEntry(
        currentTurn,
        "motionVoided",
        `Conference motion ${outcome.motion.motionId} passed its vote but ${outcome.voidReason}`,
        undefined,
        now
      )
    );
    motions.push(outcome.motion);
  }

  return { platformAppliedTurn, motions, applied, newEntries, motionsPassed, motionsVoided };
}

/**
 * Reconcile resolution side effects for a decided row (see
 * computeReconcileDecisions). Marks land in ONE batched row write guarded by
 * a compare-and-swap on the row's updatedAt: concurrent reconcilers of the
 * same row converge instead of clobbering each other's marks. The CAS loser
 * re-reads fresh and recomputes (receipts make the re-apply a no-op and
 * receipted voids adopt passed). The mark-time receipt recheck plus the
 * pending-race-void heal invariant mean a void label can never durably cover
 * a completed effect, even when the winning applier's receipt lands after
 * another pass's final confirmation read and the winner crashes before
 * marking: the next driver tick revisits the row from persisted evidence and
 * adopts the receipt (or confirms the void terminal). Attempts are bounded;
 * if contention outlasts them this call stands down and a heal resumes the
 * marks. A crash anywhere before the mark simply reconciles again.
 */
export async function reconcileConferenceEffects(
  db: Db,
  countryId: CountryId,
  party: PoliticalParty,
  doc: UKPartyConference,
  currentTurn: number,
  now: Date
): Promise<{ motionsPassed: number; motionsVoided: number }> {
  const partySeqId = partySeqIdOf(party);
  const isNpp = !party.chairId;
  const collection = getUKPartyConferencesCollection(db);
  let stoodDown = { motionsPassed: 0, motionsVoided: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const reread = attempt === 0 ? doc : ((await collection.findOne({ _id: doc._id })) ?? doc);
    const working = await adoptReceiptedVoids(db, countryId, partySeqId, reread);
    const computed = await computeReconcileDecisions(
      db,
      countryId,
      party,
      partySeqId,
      isNpp,
      working,
      currentTurn,
      now
    );
    stoodDown = { motionsPassed: computed.motionsPassed, motionsVoided: computed.motionsVoided };
    const motionsChanged =
      computed.motions.some((motion, index) => motion !== (working.motions ?? [])[index]) ||
      computed.motions.length !== (working.motions ?? []).length;
    if (
      computed.platformAppliedTurn !== (working.platformAppliedTurn ?? null) ||
      motionsChanged ||
      computed.applied.size !== (working.appliedMotionIds ?? []).length ||
      computed.newEntries.length > 0
    ) {
      let history = working.history ?? [];
      for (const entry of computed.newEntries) history = pushConferenceHistory(history, entry);
      const marked = await collection.updateOne(
        {
          _id: working._id,
          ...(working.updatedAt != null ? { updatedAt: working.updatedAt } : {}),
        },
        {
          $set: {
            motions: computed.motions,
            appliedMotionIds: [...computed.applied],
            platformAppliedTurn: computed.platformAppliedTurn,
            history,
            updatedAt: now,
          },
        }
      );
      if (marked.matchedCount === 1) return stoodDown;
      // A concurrent marker won the row under us: re-read fresh and
      // recompute instead of clobbering its marks.
      continue;
    }
    return stoodDown;
  }
  return stoodDown;
}
