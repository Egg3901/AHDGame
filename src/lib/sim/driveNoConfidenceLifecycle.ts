/**
 * Identity-level UK no-confidence lifecycle driver (issue #2103).
 *
 * Shell module: takes a Db, drives one synthetic opposition motion through
 * the REAL production seams, and fails loudly when the motion disappears.
 * The deterministic ballot it casts lives in the pure
 * `noConfidenceLifecycle.ts` contract; this module only executes it.
 *
 * Real paths exercised, in order:
 * 1. proposal + claim — `proposeNoConfidence` (writes the vote, claims
 *    `governmentFormations.activeVoteId`)
 * 2. query visibility — `getNoConfidenceVoteView` (the player-facing read)
 * 3. ballot — `castNoConfidenceVote` per fixed-ballot voter
 * 4. turn resolution — `processParliamentaryGovernmentVotes` with the
 *    in-flight turn (the hourly-turn entry point, not the resolver directly)
 *
 * Deliberate difference from `driveSyntheticActors`: that driver never
 * throws (every step is a best-effort no-op), but THIS driver throws
 * `MotionLostError` when the motion leaves its query surface before
 * `closesOnTurn` — the disappearance from #1281 is exactly what it exists
 * to catch. Setup problems (missing proposer, unformed government) also
 * throw: a lifecycle run with no motion proves nothing.
 *
 * Safety: the entry point refuses anything that is not a sandbox sim world
 * (same guard as the synthetic-actor materializer). Never point this at a
 * live game database. The driver performs no wall-clock reads of its own;
 * turn advancement belongs to the caller (the queued sandbox job).
 */

import { ObjectId, type Db } from "mongodb";
import {
  castNoConfidenceVote,
  proposeNoConfidence,
} from "@/lib/government/commands/parliamentaryGovernment";
import { getNoConfidenceVoteView } from "@/lib/government/queries/parliamentaryGovernment";
import {
  isVoteClosed,
  processParliamentaryGovernmentVotes,
} from "@/lib/turn/parliamentaryGovernment";
import {
  getGovernmentFormationsCollection,
  getNoConfidenceVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import { assertSandboxDb } from "./materializeSyntheticActors";
import {
  NO_CONFIDENCE_COUNTRY_ID,
  buildNoConfidenceBallotPlan,
  noConfidenceCooldownRemaining,
  type NoConfidenceSnapshot,
  type NoConfidenceTerminalGovernment,
} from "./noConfidenceLifecycle";

/** The motion left its query surface before its deadline. */
export class MotionLostError extends Error {
  voteId: string;
  turn: number;
  constructor(voteId: string, turn: number, detail: string) {
    super(
      `no-confidence motion ${voteId} lost on turn ${turn}: ${detail} ` +
        `(issue #2103: the motion disappeared before its deadline)`
    );
    this.name = "MotionLostError";
    this.voteId = voteId;
    this.turn = turn;
  }
}

/** Resolution was attempted before the voting window closed. */
export class MotionNotDueError extends Error {
  constructor(voteId: string, turn: number, closesOnTurn: number) {
    super(
      `no-confidence motion ${voteId} is not due on turn ${turn} ` +
        `(closesOnTurn ${closesOnTurn})`
    );
    this.name = "MotionNotDueError";
  }
}

/** Receipt for the real-command proposal. */
export interface NoConfidenceProposal {
  voteId: string;
  closesOnTurn: number;
  turnProposed: number;
  proposerCharacterIdHex: string;
  targetPmName: string;
}

/** One ballot receipt from the real vote seam. */
export interface NoConfidenceBallotReceipt {
  characterIdHex: string;
  choice: "aye" | "nay";
  votesFor: number;
  votesAgainst: number;
}

/** Terminal state after the resolving turn. */
export interface NoConfidenceTerminalState {
  status: string;
  closedAt: string | null;
  votesFor: number;
  votesAgainst: number;
  activeVoteId: string | null;
  government: NoConfidenceTerminalGovernment;
}

/** Cooldown probe outcome: a too-early re-proposal must be rejected. */
export interface NoConfidenceCooldownProbe {
  rejected: boolean;
  remainingTurns: number;
  message: string;
}

async function readActiveVoteId(db: Db): Promise<string | null> {
  const formation = await getGovernmentFormationsCollection(db).findOne({
    _id: NO_CONFIDENCE_COUNTRY_ID,
  });
  const active = formation?.activeVoteId;
  return active == null ? null : active.toString();
}

/**
 * Propose the synthetic opposition motion through the real command. Fails
 * when the proposer identity is absent, the government is unformed, a vote
 * is already in flight, or the cooldown still applies.
 */
export async function proposeNoConfidenceMotion(
  db: Db,
  seed: string
): Promise<NoConfidenceProposal> {
  await assertSandboxDb(db);
  const plan = buildNoConfidenceBallotPlan(seed);
  const proposerId = new ObjectId(plan.proposer.characterIdHex);
  const proposerChar = await db
    .collection<{ _id: ObjectId; name: string; userId?: ObjectId }>("characters")
    .findOne({ _id: proposerId });
  if (!proposerChar?.userId) {
    throw new Error(
      `no-confidence driver (seed=${seed}): proposer character ${plan.proposer.characterIdHex} ` +
        "is missing or has no user — seed the fixed-ballot chamber before proposing."
    );
  }
  const { voteId } = await proposeNoConfidence(
    db,
    NO_CONFIDENCE_COUNTRY_ID,
    proposerChar.userId.toString(),
    { _id: proposerChar._id, name: proposerChar.name }
  );
  const vote = await getNoConfidenceVotesCollection(db).findOne({
    _id: new ObjectId(voteId),
  });
  if (!vote || typeof vote.closesOnTurn !== "number") {
    throw new Error(
      `no-confidence driver (seed=${seed}): proposed vote ${voteId} has no closesOnTurn`
    );
  }
  return {
    voteId,
    closesOnTurn: vote.closesOnTurn,
    turnProposed: vote.turnProposed,
    proposerCharacterIdHex: plan.proposer.characterIdHex,
    targetPmName: vote.targetPmName,
  };
}

/**
 * Cast the fixed ballot through the real vote seam, in ballot order. Returns
 * one receipt per voter; the final receipt carries the motion totals.
 */
export async function castPlannedBallot(
  db: Db,
  seed: string,
  voteId: string
): Promise<{ receipts: NoConfidenceBallotReceipt[]; votesFor: number; votesAgainst: number }> {
  const plan = buildNoConfidenceBallotPlan(seed);
  const receipts: NoConfidenceBallotReceipt[] = [];
  let votesFor = 0;
  let votesAgainst = 0;
  for (const voter of plan.voters) {
    const result = await castNoConfidenceVote(
      db,
      NO_CONFIDENCE_COUNTRY_ID,
      { _id: new ObjectId(voter.characterIdHex) },
      voteId,
      voter.choice
    );
    votesFor = result.votesFor;
    votesAgainst = result.votesAgainst;
    receipts.push({
      characterIdHex: voter.characterIdHex,
      choice: voter.choice,
      votesFor,
      votesAgainst,
    });
  }
  return { receipts, votesFor, votesAgainst };
}

/**
 * Snapshot the motion through the player-facing query surface plus the
 * formation linkage, for one turn. Throws `MotionLostError` when the vote
 * is gone from its query surface — the #1281 disappearance this driver
 * exists to catch.
 */
export async function snapshotNoConfidenceMotion(
  db: Db,
  voteId: string,
  turn: number
): Promise<NoConfidenceSnapshot> {
  let view;
  try {
    view = await getNoConfidenceVoteView(db, NO_CONFIDENCE_COUNTRY_ID, voteId, null);
  } catch (error) {
    throw new MotionLostError(voteId, turn, error instanceof Error ? error.message : String(error));
  }
  if (view._id !== voteId) {
    throw new MotionLostError(
      voteId,
      turn,
      `query surface returned a different identity (${view._id})`
    );
  }
  return {
    turn,
    voteId: view._id,
    status: view.status,
    votesFor: view.votesFor,
    votesAgainst: view.votesAgainst,
    closesOnTurn: view.closesOnTurn,
    activeVoteId: await readActiveVoteId(db),
  };
}

/**
 * Resolve the motion through the real turn entry point once its window has
 * closed. Throws `MotionNotDueError` before `closesOnTurn`; throws
 * `MotionLostError` when the vote is gone at resolution time.
 */
export async function resolveNoConfidenceMotion(
  db: Db,
  voteId: string,
  now: Date,
  turn: number
): Promise<NoConfidenceTerminalState> {
  const vote = await getNoConfidenceVotesCollection(db).findOne({
    _id: new ObjectId(voteId),
  });
  if (!vote) {
    throw new MotionLostError(voteId, turn, "vote document is gone at resolution time");
  }
  if (typeof vote.closesOnTurn !== "number") {
    throw new Error(`no-confidence driver: vote ${voteId} has no closesOnTurn`);
  }
  if (!isVoteClosed(vote, turn, now)) {
    throw new MotionNotDueError(voteId, turn, vote.closesOnTurn);
  }
  await processParliamentaryGovernmentVotes(db, NO_CONFIDENCE_COUNTRY_ID, now, turn);
  return readTerminalState(db, voteId, vote.turnProposed, turn);
}

async function readTerminalState(
  db: Db,
  voteId: string,
  turnProposed: number,
  turn: number
): Promise<NoConfidenceTerminalState> {
  const vote = await getNoConfidenceVotesCollection(db).findOne({
    _id: new ObjectId(voteId),
  });
  if (!vote) {
    throw new MotionLostError(voteId, turn, "vote document is gone after resolution");
  }
  const formation = await getGovernmentFormationsCollection(db).findOne({
    _id: NO_CONFIDENCE_COUNTRY_ID,
  });
  const cabinetMembers = await db
    .collection("cabinetMembers")
    .countDocuments({ countryId: NO_CONFIDENCE_COUNTRY_ID });
  const active = formation?.activeVoteId;
  return {
    status: vote.status,
    closedAt: vote.closedAt ? vote.closedAt.toISOString() : null,
    votesFor: vote.votesFor,
    votesAgainst: vote.votesAgainst,
    activeVoteId: active == null ? null : active.toString(),
    government: {
      pmCharacterId: formation?.pmCharacterId ? formation.pmCharacterId.toString() : null,
      pmName: formation?.pmName ?? null,
      formationStatus: formation?.status ?? "missing",
      activeVoteId: active == null ? null : active.toString(),
      cabinetMembers,
      cooldownRemainingTurns: noConfidenceCooldownRemaining(turn, turnProposed),
    },
  };
}

/**
 * Prove the 48-turn cooldown holds: a re-proposal from the resolving turn
 * must be rejected while time remains. Skips (without proposing) once the
 * cooldown has elapsed, so the probe never files a second motion.
 */
export async function probeNoConfidenceCooldown(
  db: Db,
  seed: string,
  turnProposed: number,
  resolveTurn: number
): Promise<NoConfidenceCooldownProbe> {
  const remainingTurns = noConfidenceCooldownRemaining(resolveTurn, turnProposed);
  if (remainingTurns <= 0) {
    return { rejected: false, remainingTurns, message: "cooldown elapsed; no probe filed" };
  }
  const plan = buildNoConfidenceBallotPlan(seed);
  const proposerChar = await db
    .collection<{ _id: ObjectId; name: string; userId?: ObjectId }>("characters")
    .findOne({ _id: new ObjectId(plan.proposer.characterIdHex) });
  if (!proposerChar?.userId) {
    throw new Error("no-confidence cooldown probe: proposer character is missing");
  }
  try {
    await proposeNoConfidence(db, NO_CONFIDENCE_COUNTRY_ID, proposerChar.userId.toString(), {
      _id: proposerChar._id,
      name: proposerChar.name,
    });
  } catch (error) {
    return {
      rejected: true,
      remainingTurns,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error("no-confidence cooldown probe: re-proposal succeeded inside the cooldown window");
}
