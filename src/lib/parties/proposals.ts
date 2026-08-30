import type { Db, ObjectId } from "mongodb";
import type {
  CommitteeProposal,
  CommitteeProposalVote,
  PositionShiftAxis,
} from "@/lib/db/types/committeeProposal";
import type {
  Character,
  NationalCommitteeElection,
  NationalPartyElection,
  NationalPartyVote,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { MAX_NATIONAL_CAMPAIGNERS } from "./access";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import type { StateRegistrationPool } from "@/lib/db/types/stateRegistrationPool";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { getGameTime } from "@/lib/time/gameTime";
import { selectMergeNppCull } from "@/lib/npp/mergeNppCap";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import {
  REQUIRED_YES_FRACTION,
  POSITION_SHIFT_COOLDOWN_TURNS,
  PROPOSAL_COOLDOWN_TURNS,
} from "./proposalConstants";

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Given vote counts and committee size, returns whether the proposal
 * has passed, been rejected, or is still open.
 *
 * Per the 2026-05-22 amendments-via-CommitteeProposal redesign:
 *   - Pass requires `yes >= ceil(REQUIRED_YES_FRACTION * committeeSize)`
 *     where committeeSize counts only FILLED voter-set slots.
 *   - Reject early when the remaining un-voted slots cannot lift `yes`
 *     to the threshold even if every undecided voter votes yes.
 *   - On `expired: true`, abstainers are treated as nay — the final
 *     verdict is `passed` iff `yesCount >= yesNeeded`, otherwise
 *     `rejected`.
 */
export function checkResolution(
  yesCount: number,
  noCount: number,
  committeeSize: number,
  options?: { expired?: boolean }
): "passed" | "rejected" | "open" {
  if (committeeSize <= 0) return "rejected"; // edge: no one eligible to vote
  const yesNeeded = Math.ceil(committeeSize * REQUIRED_YES_FRACTION);
  if (yesCount >= yesNeeded) return "passed";
  // Even if every remaining voter votes yes, can yesCount still reach yesNeeded?
  const remaining = committeeSize - yesCount - noCount;
  if (yesCount + remaining < yesNeeded) return "rejected";
  if (options?.expired) {
    // Voting window closed; abstain = nay. Verdict is final based on
    // the current yes count.
    return yesCount >= yesNeeded ? "passed" : "rejected";
  }
  return "open";
}

/** Clamp a position shift to the [-5, 5] range. */
export function clampPosition(current: number, direction: 1 | -1): number {
  return Math.max(-5, Math.min(5, current + direction));
}

/**
 * Returns the set of character ObjectId strings eligible to vote on proposals
 * for the given party: committee members + chair + vice chair + treasurer.
 */
export function getEligibleVoterSet(party: PoliticalParty): Set<string> {
  const ids = new Set(party.committeeIds.map((id) => id.toString()));
  if (party.chairId) ids.add(party.chairId.toString());
  if (party.viceChairId) ids.add(party.viceChairId.toString());
  if (party.treasurerId) ids.add(party.treasurerId.toString());
  return ids;
}

// ─── Effect helpers ───────────────────────────────────────────────────────────

export async function applyRenameEffect(db: Db, proposal: CommitteeProposal): Promise<void> {
  if (!proposal.rename) throw new Error("Not a rename proposal");
  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: proposal.partyId },
    {
      $set: {
        name: proposal.rename.newName,
        abbreviation: proposal.rename.newAbbreviation,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Maps a `positionShift.axis` value to the field name on
 * `PoliticalParty` that stores the current position. Only the two axes
 * the engines read are mappable; `foreignPolicy` / `culture` were
 * retired in ticket #1032 and have no field left to write.
 */
const POSITION_SHIFT_FIELD_BY_AXIS = {
  economic: "economicPosition",
  social: "socialPosition",
} as const satisfies Record<PositionShiftAxis, keyof PoliticalParty>;

/** Narrows a stored axis to one that can still be applied. */
function isLiveAxis(axis: string): axis is PositionShiftAxis {
  return axis === "economic" || axis === "social";
}

export async function applyPositionShiftEffect(db: Db, proposal: CommitteeProposal): Promise<void> {
  if (!proposal.positionShift) throw new Error("Not a positionShift proposal");
  const { axis, direction } = proposal.positionShift;
  // Retired axes (ticket #1032) can no longer be proposed, but a proposal
  // created before the retirement could still be sitting open. There is no
  // field left to move, so treat it as a no-op rather than throwing and
  // wedging the proposal-resolution phase for the whole party.
  if (!isLiveAxis(axis)) return;
  const field = POSITION_SHIFT_FIELD_BY_AXIS[axis];
  const party = await db.collection<PoliticalParty>("politicalParties").findOne(
    { _id: proposal.partyId },
    {
      projection: {
        economicPosition: 1,
        socialPosition: 1,
      },
    }
  );
  if (!party) throw new Error("Party not found");
  // Recover from rows where a prior buggy applyPositionShiftEffect wrote NaN
  // (pre-2026-05-22 redesign would compute `clampPosition(undefined, 1)
  // = NaN` and persist it). Without the `Number.isFinite` guard, every
  // subsequent positionShift on the same axis would re-read NaN, compute
  // NaN, and re-write NaN — the proposal "passed" but the visible
  // position never moved. Treat non-finite as neutral 0 so the next
  // passing shift can recover the party.
  const currentRaw = party[field];
  const current = typeof currentRaw === "number" && Number.isFinite(currentRaw) ? currentRaw : 0;
  const newValue = clampPosition(current, direction);
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne({ _id: proposal.partyId }, { $set: { [field]: newValue, updatedAt: new Date() } });
}

export async function applyElectionMethodEffect(
  db: Db,
  proposal: CommitteeProposal
): Promise<void> {
  if (!proposal.electionMethod) throw new Error("Not an electionMethod proposal");
  const parties = db.collection<PoliticalParty>("politicalParties");
  const party = await parties.findOne(
    { _id: proposal.partyId },
    { projection: { sequentialId: 1, countryId: 1 } }
  );

  // Change the party first. Votes cast from this point onward will snapshot
  // influence in the vote route, closing the race window while we backfill
  // votes that were recorded under the previous headcount method.
  await parties.updateOne(
    { _id: proposal.partyId },
    { $set: { leadershipElectionMethod: proposal.electionMethod.method, updatedAt: new Date() } }
  );

  if (
    proposal.electionMethod.method !== "influence" ||
    !party ||
    party.sequentialId === undefined
  ) {
    return;
  }

  const partyId = String(party.sequentialId);
  const countryId = party.countryId ?? "US";
  const activeElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find({ partyId, countryId, status: "voting" })
    .toArray();
  if (activeElections.length === 0) return;

  const electionIds = activeElections.map((election) => election._id);
  const votes = await db
    .collection<NationalPartyVote>("nationalPartyVotes")
    .find({
      electionId: { $in: electionIds },
      voterPartyInfluence: { $exists: false },
    })
    .toArray();
  if (votes.length === 0) return;

  const voterIds = [
    ...new Map(votes.map((vote) => [vote.voterId.toString(), vote.voterId])).values(),
  ];
  const voters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: voterIds } }, { projection: { partyInfluence: 1 } })
    .toArray();
  const influenceByVoter = new Map(
    voters.map((voter) => [
      voter._id.toString(),
      typeof voter.partyInfluence === "number" && Number.isFinite(voter.partyInfluence)
        ? voter.partyInfluence
        : 0,
    ])
  );

  await db.collection<NationalPartyVote>("nationalPartyVotes").bulkWrite(
    votes.map((vote) => ({
      updateOne: {
        filter: {
          electionId: vote.electionId,
          voterId: vote.voterId,
          voterPartyInfluence: { $exists: false },
        },
        update: {
          $set: { voterPartyInfluence: influenceByVoter.get(vote.voterId.toString()) ?? 0 },
        },
      },
    }))
  );
}

export async function applyElectionDurationEffect(
  db: Db,
  proposal: CommitteeProposal
): Promise<void> {
  if (!proposal.electionDuration) throw new Error("Not an electionDuration proposal");
  const newDurationTurns = proposal.electionDuration.durationTurns;
  const now = new Date();

  // 1. Persist the custom duration on the party doc — controls FUTURE
  //    election spawns in createMissingNationalElections /
  //    createMissingCommitteeElections.
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { _id: proposal.partyId },
      { $set: { customElectionDurationTurns: newDurationTurns, updatedAt: now } }
    );

  // 2. Look up the party so we can scope election queries by
  //    sequentialId + countryId — that's the shape election rows store.
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ _id: proposal.partyId }, { projection: { sequentialId: 1, countryId: 1 } });
  if (!party || party.sequentialId === undefined) return;
  const partyKey = String(party.sequentialId);
  const countryKey = party.countryId ?? "US";

  // 3. Pull current game time once for the shrink guard.
  const { currentTurn, effectiveNow } = await getGameTime();

  // 4. Stretch in-flight officer elections. Anchoring on the existing
  //    startTurn / startTime preserves candidacies and votes; only the
  //    close-time moves. Skip rows where the new duration would close
  //    the election immediately (shrink guard).
  const officerRows = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find({ partyId: partyKey, countryId: countryKey, status: "voting" })
    .toArray();

  const officerOps = officerRows.flatMap((election) => {
    const newEndTurn = election.startTurn + newDurationTurns;
    const newEndTime = new Date(
      new Date(election.startTime).getTime() + newDurationTurns * 60 * 60 * 1000
    );
    if (newEndTurn <= currentTurn || newEndTime.getTime() <= effectiveNow.getTime()) {
      return [];
    }
    return [
      {
        updateOne: {
          filter: { _id: election._id },
          update: {
            $set: {
              durationTurns: newDurationTurns,
              endTurn: newEndTurn,
              endTime: newEndTime,
              updatedAt: now,
            },
          },
        },
      },
    ];
  });
  if (officerOps.length > 0) {
    await db.collection<NationalPartyElection>("nationalPartyElections").bulkWrite(officerOps);
  }

  // 5. Stretch in-flight committee elections with identical logic.
  const committeeRows = await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .find({ partyId: partyKey, countryId: countryKey, status: "voting" })
    .toArray();

  const committeeOps = committeeRows.flatMap((election) => {
    const newEndTurn = election.startTurn + newDurationTurns;
    const newEndTime = new Date(
      new Date(election.startTime).getTime() + newDurationTurns * 60 * 60 * 1000
    );
    if (newEndTurn <= currentTurn || newEndTime.getTime() <= effectiveNow.getTime()) {
      return [];
    }
    return [
      {
        updateOne: {
          filter: { _id: election._id },
          update: {
            $set: {
              durationTurns: newDurationTurns,
              endTurn: newEndTurn,
              endTime: newEndTime,
              updatedAt: now,
            },
          },
        },
      },
    ];
  });
  if (committeeOps.length > 0) {
    await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .bulkWrite(committeeOps);
  }
}

/**
 * Toggles `PoliticalParty.transactionApprovalMode` to the value carried
 * by the proposal. Used by the 2026-05-22 treasury-two-person-approval
 * workflow to switch a party between "single" (auto-approve) and
 * "double" (Treasurer + Chair/VC) modes.
 */
export async function applyTransactionApprovalModeEffect(
  db: Db,
  proposal: CommitteeProposal
): Promise<void> {
  if (!proposal.transactionApprovalMode) {
    throw new Error("Not a transactionApprovalMode proposal");
  }
  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: proposal.partyId },
    {
      $set: {
        transactionApprovalMode: proposal.transactionApprovalMode.mode,
        updatedAt: new Date(),
      },
    }
  );
}

/**
 * Vacate an elected seat on the party. The filter includes the target
 * character so a no-op happens if the target has been removed or
 * replaced between proposal creation and resolution (e.g. via a
 * leadership election that ran while the vote was open). This prevents
 * the resolver from clearing a now-unrelated person's seat.
 *
 * When the chair seat is cleared, the vice-chair (if seated) inherits
 * chair authority via `canActAsChair` — no schema mutation needed.
 */
export async function applyRemoveOfficeHolderEffect(
  db: Db,
  proposal: CommitteeProposal
): Promise<void> {
  if (!proposal.removeOfficeHolder) throw new Error("Not a removeOfficeHolder proposal");
  const { role, targetCharacterId } = proposal.removeOfficeHolder;
  const now = new Date();

  if (role === "chair") {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: proposal.partyId, chairId: targetCharacterId },
        { $set: { chairId: null, updatedAt: now } }
      );
    // Re-sync any coalitions this party leads — their stored chair-
    // character must follow the lead party's actual chairId or the
    // coalition page renders the removed character as chair.
    const { syncCoalitionChairsForParty } = await import("@/lib/coalitions/syncCoalitionChair");
    await syncCoalitionChairsForParty(db, proposal.partyId, now);
  } else if (role === "viceChair") {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: proposal.partyId, viceChairId: targetCharacterId },
        { $set: { viceChairId: null, updatedAt: now } }
      );
  } else if (role === "treasurer") {
    // Vacate the treasurer seat. Unlike chair there is no coalition sync;
    // treasurerId: null is already a handled state (leave-party, admin
    // appointment, and banned-user cleanup all vacate it), and the chair
    // can re-appoint or a fresh election can refill it.
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: proposal.partyId, treasurerId: targetCharacterId },
        { $set: { treasurerId: null, updatedAt: now } }
      );
  } else if (role === "campaigner") {
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: proposal.partyId, campaignerIds: targetCharacterId },
      {
        $pull: { campaignerIds: targetCharacterId } as Record<string, unknown>,
        $set: { updatedAt: now },
      }
    );
  } else {
    // committeeMember
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: proposal.partyId, committeeIds: targetCharacterId },
      {
        $pull: { committeeIds: targetCharacterId } as Record<string, unknown>,
        $set: { updatedAt: now },
      }
    );
  }
}

/**
 * Seat a chair-nominated Campaigner once the National Committee has
 * confirmed. Re-validates at resolution time rather than trusting the
 * state that held when the nomination was filed:
 *
 *  - the nominee must still be a member of this party (they may have
 *    left or been purged while the vote sat open), and
 *  - the roster must still be under `MAX_NATIONAL_CAMPAIGNERS` (two
 *    nominations can be open at once, so the later one can arrive at a
 *    full roster).
 *
 * Either miss is a silent no-op: the proposal still records as passed,
 * the seat just isn't granted.
 */
export async function applyCampaignerAppointmentEffect(
  db: Db,
  proposal: CommitteeProposal
): Promise<void> {
  if (!proposal.campaignerAppointment) throw new Error("Not a campaignerAppointment proposal");
  const { targetCharacterId } = proposal.campaignerAppointment;

  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { _id: proposal.partyId },
      { projection: { campaignerIds: 1, sequentialId: 1, countryId: 1 } }
    );
  if (!party) return;

  const current = party.campaignerIds ?? [];
  if (current.some((id) => id.equals(targetCharacterId))) return;
  if (current.length >= MAX_NATIONAL_CAMPAIGNERS) return;

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: targetCharacterId }, { projection: { party: 1, countryId: 1 } });
  if (!character) return;
  if (character.party !== String(party.sequentialId) || character.countryId !== party.countryId) {
    return;
  }

  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: proposal.partyId },
    {
      $addToSet: { campaignerIds: targetCharacterId } as Record<string, unknown>,
      $set: { updatedAt: new Date() },
    }
  );
}

// ─── Cooldown read helpers (pure) ─────────────────────────────────────────────

/**
 * True when the given positionShift axis is currently locked on this
 * party. Returns false when the cooldown map is absent, the axis entry
 * is absent, or the lock has expired.
 *
 * Caller is responsible for passing the current turn (no GameState read
 * inside this pure helper).
 */
export function isPositionShiftLocked(
  party: Pick<PoliticalParty, "positionShiftCooldowns">,
  // Only live axes can be proposed, so only they can be locked. Retired
  // axes (ticket #1032) have no cooldown entry left to consult.
  axis: PositionShiftAxis,
  currentTurn: number
): boolean {
  const lock = party.positionShiftCooldowns?.[axis];
  return lock != null && lock.lockedUntilTurn > currentTurn;
}

/**
 * True when the given non-positionShift proposal type is currently
 * locked on this party. Same return semantics as
 * `isPositionShiftLocked`.
 */
export function isProposalTypeLocked(
  party: Pick<PoliticalParty, "proposalCooldowns">,
  type:
    | "rename"
    | "merge"
    | "electionMethod"
    | "electionDuration"
    | "removeOfficeHolder"
    | "transactionApprovalMode",
  currentTurn: number
): boolean {
  const lock = party.proposalCooldowns?.[type];
  return lock != null && lock.lockedUntilTurn > currentTurn;
}

// ─── Cooldown write helpers ───────────────────────────────────────────────────

/**
 * Sets the cooldown for a passed proposal. positionShift locks the
 * affected axis; all other types lock their type-keyed cooldown. Called
 * from `attemptResolution` after the effect applies and before the
 * proposal is marked resolved.
 *
 * Per the 2026-05-22 amendments-via-CommitteeProposal redesign.
 */
export async function setProposalCooldown(
  db: Db,
  proposal: CommitteeProposal,
  currentTurn: number
): Promise<void> {
  if (proposal.type === "positionShift") {
    const axis = proposal.positionShift?.axis;
    if (!axis) return;
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: proposal.partyId },
      {
        $set: {
          [`positionShiftCooldowns.${axis}.lockedUntilTurn`]:
            currentTurn + POSITION_SHIFT_COOLDOWN_TURNS,
        },
      }
    );
    return;
  }
  // campaignerAppointment carries no cooldown — the chair must be able to
  // re-nominate the moment a slot opens (or a nomination is voted down).
  if (proposal.type === "campaignerAppointment") return;
  // rename / merge / electionMethod / electionDuration
  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: proposal.partyId },
    {
      $set: {
        [`proposalCooldowns.${proposal.type}.lockedUntilTurn`]:
          currentTurn + PROPOSAL_COOLDOWN_TURNS,
      },
    }
  );
}

// ─── Merge execution ──────────────────────────────────────────────────────────

export async function processMergeProposal(
  db: Db,
  proposal: CommitteeProposal,
  currentTurn: number
): Promise<void> {
  if (!proposal.merge) throw new Error("Not a merge proposal");

  const [proposingParty, targetParty] = await Promise.all([
    db.collection<PoliticalParty>("politicalParties").findOne({ _id: proposal.partyId }),
    db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ _id: proposal.merge.targetPartyId }),
  ]);
  if (!proposingParty) throw new Error("Proposing party not found");
  if (!targetParty) throw new Error("Target party not found");
  if (targetParty.isDefunct) throw new Error("Target party is defunct");

  const proposingStrId = String(proposingParty.sequentialId);
  const targetStrId = String(targetParty.sequentialId);
  const countryId = proposingParty.countryId;
  const now = new Date();

  // 1. Transfer characters — move party membership, halve partyInfluence
  await db.collection("characters").updateMany({ party: proposingStrId, countryId }, [
    {
      $set: {
        party: targetStrId,
        // Tenure clock resets on merge-absorption (see leadershipTenure.ts).
        partyJoinedTurn: currentTurn,
        partyInfluence: {
          $floor: { $multiply: [{ $ifNull: ["$partyInfluence", 0] }, 0.5] },
        },
      },
    },
  ]);

  // 2. NPP transfer is deferred to step 4c — it must run *after* the state-org
  //    merge (step 4) so the per-state recruitment cap is sized off the
  //    surviving party's POST-merge organization.

  // 3. Transfer national treasury
  if (proposingParty.treasury > 0) {
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: targetParty._id },
        { $inc: { treasury: proposingParty.treasury }, $set: { updatedAt: now } }
      );
  }

  // 4. Merge state org — add 50% of each proposing state org's organization to target
  const proposingOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ partyId: proposingStrId, countryId })
    .toArray();

  for (const org of proposingOrgs) {
    const bonus = Math.floor(org.organization * 0.5);
    if (bonus <= 0) continue;
    const targetOrgId = `${org.stateId}_${targetStrId}`;
    const exists = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: targetOrgId }, { projection: { _id: 1 } });

    if (exists) {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne(
          { _id: targetOrgId },
          { $inc: { organization: bonus }, $set: { hasPresence: true, updatedAt: now } }
        );
    } else {
      // Create minimal state org record for target in this state
      await db.collection<StatePartyOrg>("statePartyOrg").insertOne({
        _id: targetOrgId,
        countryId,
        stateId: org.stateId,
        partyId: targetStrId,
        organization: bonus,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        treasury: 0,
        stateTaxRate: 0,
        politicalStrength: 0,
        hasPresence: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 4b. Wipe the absorbed party's state footprint. The target kept 50% of each
  //     state org (transferred above); the *remainder* is not carried over.
  //     Release any registration back to the state's unregistered pool so the
  //     0..100 reg invariant is preserved (the merged party's lean is lost, not
  //     inherited), then delete the rows so the defunct party stops surfacing in
  //     state Org/Reg views.
  for (const org of proposingOrgs) {
    const reg = typeof org.registration === "number" ? org.registration : 0;
    if (reg > 0) {
      await db
        .collection<StateRegistrationPool>("stateRegistrationPool")
        .updateOne(
          { _id: `${countryId}_${org.stateId}` },
          { $inc: { unregistered: reg }, $set: { updatedAt: now } }
        );
    }
  }
  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .deleteMany({ partyId: proposingStrId, countryId });

  // 4c. Transfer NPPs with the per-state recruitment cap enforced. The target
  //     keeps all of its own NPPs; the absorbed party's active NPPs fill the
  //     remaining slots in each home state (strongest first). Any over the cap
  //     are hard-deleted so a merge can't stack a region past the limit a fresh
  //     recruit would face. Retired NPPs carry no cap weight and always re-point
  //     to the target for historical continuity.
  const proposingActiveNpps = await db
    .collection<NPP>("npps")
    .find({ party: proposingStrId, countryId, retiredAt: null })
    .toArray();

  // Surviving party's POST-merge org per state (re-read after step 4 merged it).
  const targetOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ partyId: targetStrId, countryId })
    .toArray();
  const targetOrgByState = new Map<string, number>(
    targetOrgs.map((o) => [o.stateId, o.organization ?? 0])
  );

  // Surviving party's existing active NPP count per state — these consume slots
  // before any incoming NPP does.
  const targetActiveNpps = await db
    .collection<NPP>("npps")
    .find({ party: targetStrId, countryId, retiredAt: null }, { projection: { homeState: 1 } })
    .toArray();
  const targetActiveCountByState = new Map<string, number>();
  for (const n of targetActiveNpps) {
    targetActiveCountByState.set(n.homeState, (targetActiveCountByState.get(n.homeState) ?? 0) + 1);
  }

  const { cull } = selectMergeNppCull({
    proposingNpps: proposingActiveNpps,
    targetActiveCountByState,
    targetOrgByState,
  });
  const cullIds = cull.map((n) => n._id);

  // Re-point every absorbed NPP that survives (kept active + all retired) to the
  // target in a single pass; the cull set is excluded.
  await db
    .collection<NPP>("npps")
    .updateMany(
      { party: proposingStrId, countryId, _id: { $nin: cullIds } },
      { $set: { party: targetStrId } }
    );

  // Hard-delete the over-cap overflow and cascade-clean their references so no
  // seat or candidacy row points at a deleted NPP (mirrors the admin NPP delete
  // cascade; senate vacancies notify the governor as in the party-delete route).
  if (cullIds.length > 0) {
    const heldOfficials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ nppId: { $in: cullIds } })
      .toArray();
    if (heldOfficials.length > 0) {
      await db
        .collection<ElectedOfficial>("electedOfficials")
        .deleteMany({ _id: { $in: heldOfficials.map((o) => o._id) } });
      for (const o of heldOfficials) {
        if (o.officeType === "senate") {
          await notifyGovernorOfSenateVacancy(db, o.state, o.senateClass);
        }
      }
    }
    await db.collection("electionCandidates").deleteMany({ nppId: { $in: cullIds } });
    await db.collection<NPP>("npps").deleteMany({ _id: { $in: cullIds } });
  }

  // 5. Transfer elected seats — re-point all of the absorbed party's elected
  //    officials (any chamber) to the target so its legislative seats move with
  //    it. Country-scoped: `party` (sequentialId) is not globally unique.
  await db
    .collection<ElectedOfficial>("electedOfficials")
    .updateMany(
      { party: proposingStrId, countryId },
      { $set: { party: targetStrId, updatedAt: now } }
    );

  // 6. Collapse the absorbed party out of any coalitions — transfer its slot to
  //    the target and strip dangling invites/requests addressed to it.
  const { absorbPartyIntoCoalitions } = await import("@/lib/coalitions/absorbParty");
  await absorbPartyIntoCoalitions(db, { countryId, proposingParty, targetParty, now });

  // 7. Rebuild the parliamentary seat snapshot from the re-pointed officials and
  //    updated coalition membership. Only when the country tracks a government
  //    formation (parliamentary systems); presidential systems read seats live.
  const govCol = db.collection<GovernmentFormation>("governmentFormations");
  const gov = await govCol.findOne({ _id: countryId });
  if (gov) {
    const govSet: Record<string, unknown> = {};
    if (gov.governingPartyId === proposingStrId) govSet.governingPartyId = targetStrId;
    if (Array.isArray(gov.coalitionPartyIds) && gov.coalitionPartyIds.includes(proposingStrId)) {
      govSet.coalitionPartyIds = Array.from(
        new Set(gov.coalitionPartyIds.map((id) => (id === proposingStrId ? targetStrId : id)))
      );
    }
    if (Object.keys(govSet).length > 0) {
      await govCol.updateOne({ _id: countryId }, { $set: { ...govSet, updatedAt: now } });
    }
    const { updateParliamentaryGovernmentSeats } =
      await import("@/lib/turn/parliamentaryGovernment");
    await updateParliamentaryGovernmentSeats(db, countryId);
  }

  // 8. Recount target party member count after transfer
  const newMemberCount = await db
    .collection("characters")
    .countDocuments({ party: targetStrId, countryId: targetParty.countryId });

  // 9. Defunct the proposing party — clear leadership and mark dissolved
  await db.collection<PoliticalParty>("politicalParties").updateOne(
    { _id: proposingParty._id },
    {
      $set: {
        isDefunct: true,
        defunctAtTurn: currentTurn,
        mergedIntoPartyId: targetParty._id,
        chairId: null,
        viceChairId: null,
        treasurerId: null,
        committeeIds: [],
        memberCount: 0,
        treasury: 0,
        updatedAt: now,
      },
    }
  );

  // 10. Update target party member count
  await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne({ _id: targetParty._id }, { $set: { memberCount: newMemberCount, updatedAt: now } });
}

// ─── Resolution ───────────────────────────────────────────────────────────────

async function markResolved(
  db: Db,
  id: ObjectId,
  status: "passed" | "rejected",
  turn: number
): Promise<void> {
  await db
    .collection("committeeProposals")
    .updateOne({ _id: id }, { $set: { status, resolvedAtTurn: turn, updatedAt: new Date() } });
}

/**
 * Called after every vote. Resolves early if the outcome is already
 * determined. When `options.expired` is true (called from
 * `expireOpenProposals`), abstainers count as nay — the proposal lands
 * in `passed` or `rejected` regardless of whether the threshold is
 * mathematically locked yet.
 */
export async function attemptResolution(
  db: Db,
  proposal: CommitteeProposal,
  currentTurn: number,
  options?: { expired?: boolean }
): Promise<void> {
  if (proposal.status !== "open") return;

  const proposingParty = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(
      { _id: proposal.partyId },
      { projection: { committeeIds: 1, chairId: 1, viceChairId: 1, treasurerId: 1 } }
    );
  if (!proposingParty) return;

  // removeOfficeHolder excludes the target from both the voter set AND
  // the denominator (procedural fairness — you don't get to vote on
  // your own removal, and your absence doesn't artificially raise the
  // threshold against you).
  const baseVoterSet = getEligibleVoterSet(proposingParty);
  if (proposal.type === "removeOfficeHolder" && proposal.removeOfficeHolder) {
    baseVoterSet.delete(proposal.removeOfficeHolder.targetCharacterId.toString());
  }
  // Same procedural fairness rule for a campaigner nomination — a nominee
  // who happens to sit on the committee doesn't get to confirm themselves.
  if (proposal.type === "campaignerAppointment" && proposal.campaignerAppointment) {
    baseVoterSet.delete(proposal.campaignerAppointment.targetCharacterId.toString());
  }
  const proposingSize = baseVoterSet.size;
  const pYes = proposal.proposingVotes.filter((v) => v.vote === "yes").length;
  const pNo = proposal.proposingVotes.filter((v) => v.vote === "no").length;
  const proposingOutcome = checkResolution(pYes, pNo, proposingSize, options);

  if (proposal.type === "merge") {
    if (proposingOutcome === "rejected") {
      await markResolved(db, proposal._id, "rejected", currentTurn);
      return;
    }
    if (!proposal.merge) return;

    const targetParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne(
        { _id: proposal.merge.targetPartyId },
        { projection: { committeeIds: 1, chairId: 1, viceChairId: 1, treasurerId: 1 } }
      );
    if (!targetParty) return;

    const targetSize = getEligibleVoterSet(targetParty).size;
    const tYes = (proposal.targetVotes ?? []).filter((v) => v.vote === "yes").length;
    const tNo = (proposal.targetVotes ?? []).filter((v) => v.vote === "no").length;
    const targetOutcome = checkResolution(tYes, tNo, targetSize, options);

    if (targetOutcome === "rejected") {
      await markResolved(db, proposal._id, "rejected", currentTurn);
    } else if (proposingOutcome === "passed" && targetOutcome === "passed") {
      await processMergeProposal(db, proposal, currentTurn);
      await setProposalCooldown(db, proposal, currentTurn);
      await markResolved(db, proposal._id, "passed", currentTurn);
    }
    // else: still open — both committees haven't reached threshold yet
  } else {
    if (proposingOutcome === "rejected") {
      await markResolved(db, proposal._id, "rejected", currentTurn);
    } else if (proposingOutcome === "passed") {
      if (proposal.type === "rename") await applyRenameEffect(db, proposal);
      if (proposal.type === "positionShift") await applyPositionShiftEffect(db, proposal);
      if (proposal.type === "electionMethod") await applyElectionMethodEffect(db, proposal);
      if (proposal.type === "electionDuration") await applyElectionDurationEffect(db, proposal);
      if (proposal.type === "removeOfficeHolder") await applyRemoveOfficeHolderEffect(db, proposal);
      if (proposal.type === "transactionApprovalMode") {
        await applyTransactionApprovalModeEffect(db, proposal);
      }
      if (proposal.type === "campaignerAppointment") {
        await applyCampaignerAppointmentEffect(db, proposal);
      }
      await setProposalCooldown(db, proposal, currentTurn);
      await markResolved(db, proposal._id, "passed", currentTurn);
    }
  }
}

// ─── Vote casting ─────────────────────────────────────────────────────────────

/**
 * Records or replaces a vote from voterId on the given proposal.
 * side = "proposing": updates proposingVotes
 * side = "target":   updates targetVotes (merge only)
 * Calls attemptResolution after recording.
 */
export async function castVote(
  db: Db,
  proposalId: ObjectId,
  voterId: ObjectId,
  vote: "yes" | "no",
  side: "proposing" | "target",
  currentTurn: number
): Promise<CommitteeProposal | null> {
  const voteArray = side === "proposing" ? "proposingVotes" : "targetVotes";
  const now = new Date();
  const newVote: CommitteeProposalVote = { voterId, vote, votedAt: now };

  // Remove any existing vote from this voter, then push the new one (two ops — acceptable for user-driven writes)
  await db
    .collection<CommitteeProposal>("committeeProposals")
    .updateOne(
      { _id: proposalId, status: "open" },
      { $pull: { [voteArray]: { voterId } } as Record<string, unknown> }
    );
  await db.collection<CommitteeProposal>("committeeProposals").updateOne(
    { _id: proposalId, status: "open" },
    {
      $push: { [voteArray]: newVote } as Record<string, unknown>,
      $set: { updatedAt: now },
    }
  );

  const updated = await db
    .collection<CommitteeProposal>("committeeProposals")
    .findOne({ _id: proposalId });
  if (!updated) return null;

  await attemptResolution(db, updated, currentTurn);
  return updated;
}

// ─── Turn system ──────────────────────────────────────────────────────────────

/**
 * Resolves all open proposals whose voting window has closed. At expiry,
 * abstainers count as nay (see `checkResolution`) — so a proposal that
 * sat with 4/9 yes / 0 no / 5 abstentions for the full 24 turns
 * resolves as `rejected` (4 < ceil(0.6 × 9) = 6).
 *
 * Replaces the legacy "mark all expired with no effect-application"
 * behavior. Per the 2026-05-22 redesign, proposals always land in
 * `passed` or `rejected` — the `"expired"` status literal stays in
 * the type union for legacy data compatibility but no new proposal
 * lands there.
 *
 * Returns count resolved (regardless of pass / reject).
 */
export async function expireOpenProposals(db: Db, currentTurn: number): Promise<number> {
  const expired = await db
    .collection<CommitteeProposal>("committeeProposals")
    .find({ status: "open", expiresAtTurn: { $lte: currentTurn } })
    .toArray();
  let resolved = 0;
  for (const proposal of expired) {
    await attemptResolution(db, proposal, currentTurn, { expired: true });
    resolved += 1;
  }
  return resolved;
}
