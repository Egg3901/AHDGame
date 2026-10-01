/**
 * Deterministic UK no-confidence motion lifecycle contract (issue #2103).
 *
 * Pure rules module: no database, no wall clock, no randomness, no env, no
 * network — so the fixed ballot, the retention/terminal checks, and the
 * lifecycle report they feed are deterministic and unit-testable. The shell
 * driver in `driveNoConfidenceLifecycle.ts` runs this contract against the
 * REAL proposal, query, vote, and turn-resolution seams in a sandbox world;
 * this module only computes what that run must observe.
 *
 * Fixed ballot (5 seated Commons voters, each one seat):
 * - the eligible opposition proposer votes aye (the motion)
 * - two further opposition voters vote aye, two government voters vote nay
 * - totals are votesFor=3, votesAgainst=2, which cannot reach a Commons
 *   majority threshold, so the expected terminal outcome is `failed` and the
 *   sitting PM survives. The expected outcome is computed through the REAL
 *   carry rule (`noConfidenceMotionCarries`), not asserted, so a change to
 *   that rule fails the contract instead of silently redefining the ballot.
 *
 * Ballot identities derive from `syntheticObjectIdHex` under a `vonc:`
 * namespace, which never collides with the synthetic-actor plan namespaces
 * (`actor:`, `character:`, `user:`, `ticker:`, ...). The plan intentionally
 * adds no roles to `SYNTHETIC_ACTOR_ROLES`, so the actor plan version and
 * the materialized population are untouched by this issue.
 */

import { noConfidenceMotionCarries } from "@/lib/turn/parliamentaryGovernment";
import {
  NO_CONFIDENCE_COOLDOWN_TURNS,
  PM_VOTE_DURATION_HOURS,
} from "@/lib/constants/governmentFormation";
import { syntheticObjectIdHex } from "./actorCoverage";

/** Registry id for the UK no-confidence lifecycle mechanic. */
export const NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID = "uk-no-confidence-lifecycle";

/** Country this lifecycle driver is scoped to. */
export const NO_CONFIDENCE_COUNTRY_ID = "UK" as const;

/** Preset the bounded experiment in #2103 runs against. */
export const NO_CONFIDENCE_PRESET = "1979-default";

/** Fixed deterministic ballot totals for every seed. */
export const NO_CONFIDENCE_FIXED_TOTALS = { votesFor: 3, votesAgainst: 2 } as const;

/** One seated Commons voter in the fixed ballot. */
export interface NoConfidenceVoterPlan {
  /** Deterministic 24-hex character id for this seed + voter index. */
  characterIdHex: string;
  /** Fixed ballot choice: "aye" backs the motion, "nay" keeps the government. */
  choice: "aye" | "nay";
  /** Seats held; always 1 so totals equal ballot counts. */
  seats: 1;
}

/** Deterministic ballot plan for one seed. Same seed always yields the same plan. */
export interface NoConfidenceBallotPlan {
  seed: string;
  countryId: typeof NO_CONFIDENCE_COUNTRY_ID;
  /** Eligible synthetic opposition Commons MP; proposes and votes aye. */
  proposer: NoConfidenceVoterPlan;
  /** Remaining seated voters in ballot order (index 0 is the proposer). */
  voters: NoConfidenceVoterPlan[];
  expectedVotesFor: number;
  expectedVotesAgainst: number;
}

/** Fixed ballot choices after the proposer: aye, aye, nay, nay. */
const FOLLOWER_CHOICES: ReadonlyArray<"aye" | "nay"> = ["aye", "aye", "nay", "nay"];

/** Build the deterministic ballot plan for a seed. */
export function buildNoConfidenceBallotPlan(seed: string): NoConfidenceBallotPlan {
  const voter = (index: number, choice: "aye" | "nay"): NoConfidenceVoterPlan => ({
    characterIdHex: syntheticObjectIdHex(seed, `vonc:voter:${index}`),
    choice,
    seats: 1,
  });
  const proposer = voter(0, "aye");
  const voters = [proposer, ...FOLLOWER_CHOICES.map((choice, i) => voter(i + 1, choice))];
  const expectedVotesFor = voters.filter((v) => v.choice === "aye").length;
  const expectedVotesAgainst = voters.length - expectedVotesFor;
  return {
    seed,
    countryId: NO_CONFIDENCE_COUNTRY_ID,
    proposer,
    voters,
    expectedVotesFor,
    expectedVotesAgainst,
  };
}

/**
 * Expected terminal outcome for the fixed ballot under the REAL carry rule.
 * A motion carries only at a whole-chamber majority threshold, so the fixed
 * 3-2 ballot fails for any sane Commons threshold.
 */
export function expectedNoConfidenceOutcome(
  plan: NoConfidenceBallotPlan,
  majorityThreshold: number,
  totalSeats?: number
): "passed" | "failed" {
  return noConfidenceMotionCarries({
    votesFor: plan.expectedVotesFor,
    votesAgainst: plan.expectedVotesAgainst,
    majorityThreshold,
    totalSeats,
  })
    ? "passed"
    : "failed";
}

/**
 * Turn on which a motion proposed on `turnProposed` closes. Single-sourced
 * from the production duration constant the proposal command uses.
 */
export function noConfidenceClosesOnTurn(turnProposed: number): number {
  return turnProposed + PM_VOTE_DURATION_HOURS;
}

/**
 * Cooldown turns remaining before another motion may be proposed, measured
 * from the resolving turn. Zero means the next proposal is already allowed.
 */
export function noConfidenceCooldownRemaining(resolveTurn: number, turnProposed: number): number {
  return Math.max(0, NO_CONFIDENCE_COOLDOWN_TURNS - (resolveTurn - turnProposed));
}

// ─── Retention ──────────────────────────────────────────────────────────────

/** One per-turn observation of the in-flight motion through the query surface. */
export interface NoConfidenceSnapshot {
  turn: number;
  voteId: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  closesOnTurn: number | null;
  /** `governmentFormations.activeVoteId` observed on the same turn. */
  activeVoteId: string | null;
}

export interface RetentionCheck {
  ok: boolean;
  reason: string;
}

/**
 * Prove the motion survived every in-flight turn with one stable identity:
 * same vote id, still visible, still active, and still linked from
 * `governmentFormations.activeVoteId`. A disappearance, replacement (id
 * change), premature close, or dropped linkage before `closesOnTurn` fails.
 */
export function checkMotionRetention(
  proposedVoteId: string,
  closesOnTurn: number,
  snapshots: NoConfidenceSnapshot[]
): RetentionCheck {
  if (snapshots.length === 0) {
    return { ok: false, reason: "no in-flight snapshots were recorded" };
  }
  for (const snap of snapshots) {
    if (snap.turn >= closesOnTurn) continue;
    if (snap.voteId !== proposedVoteId) {
      return {
        ok: false,
        reason:
          `motion replaced before its deadline: turn ${snap.turn} shows vote ` +
          `${snap.voteId} instead of ${proposedVoteId}`,
      };
    }
    if (snap.status !== "active") {
      return {
        ok: false,
        reason: `motion left active state early: turn ${snap.turn} shows status ${snap.status}`,
      };
    }
    if (snap.activeVoteId !== proposedVoteId) {
      return {
        ok: false,
        reason:
          `active-vote linkage broken on turn ${snap.turn}: ` +
          `activeVoteId is ${snap.activeVoteId ?? "null"}`,
      };
    }
  }
  const inFlight = snapshots.filter((s) => s.turn < closesOnTurn);
  return {
    ok: true,
    reason:
      `${inFlight.length} in-flight snapshot(s) retain vote ${proposedVoteId} ` +
      `with active linkage through closesOnTurn ${closesOnTurn}`,
  };
}

// ─── Terminal resolution ────────────────────────────────────────────────────

export interface TerminalCheck {
  ok: boolean;
  reason: string;
}

/**
 * Prove the motion resolved exactly once into the expected terminal state:
 * one active-to-final transition, closed stamp set, totals matching the
 * fixed ballot, and a repeat resolution pass that changes nothing.
 */
export function checkTerminalResolution(input: {
  voteId: string;
  expectedOutcome: "passed" | "failed";
  expectedVotesFor: number;
  expectedVotesAgainst: number;
  /** Status observed just before the resolving turn. */
  statusBeforeResolve: string;
  /** Status observed just after the resolving turn. */
  statusAfterResolve: string;
  /** Status observed after one additional turn (repeat resolution ran). */
  statusAfterExtraTurn: string;
  closedAt: string | null;
  votesFor: number;
  votesAgainst: number;
  /** True when the repeat resolution pass left the record untouched. */
  repeatPassNoop: boolean;
}): TerminalCheck {
  if (input.statusBeforeResolve !== "active") {
    return {
      ok: false,
      reason: `motion was not active going into resolution (was ${input.statusBeforeResolve})`,
    };
  }
  if (input.statusAfterResolve !== input.expectedOutcome) {
    return {
      ok: false,
      reason:
        `motion resolved to ${input.statusAfterResolve}, ` +
        `expected ${input.expectedOutcome} for the fixed ballot`,
    };
  }
  if (input.statusAfterExtraTurn !== input.expectedOutcome) {
    return {
      ok: false,
      reason:
        `terminal state did not hold: ${input.statusAfterExtraTurn} ` +
        `one turn after resolving ${input.expectedOutcome}`,
    };
  }
  if (!input.closedAt) {
    return { ok: false, reason: "resolved motion carries no closedAt stamp" };
  }
  if (
    input.votesFor !== input.expectedVotesFor ||
    input.votesAgainst !== input.expectedVotesAgainst
  ) {
    return {
      ok: false,
      reason:
        `terminal totals ${input.votesFor}-${input.votesAgainst} do not match ` +
        `the fixed ballot ${input.expectedVotesFor}-${input.expectedVotesAgainst}`,
    };
  }
  if (!input.repeatPassNoop) {
    return { ok: false, reason: "repeat resolution pass was not a no-op" };
  }
  return {
    ok: true,
    reason:
      `vote ${input.voteId} transitioned active -> ${input.expectedOutcome} exactly once ` +
      `at ${input.votesFor}-${input.votesAgainst} with closedAt ${input.closedAt}`,
  };
}

// ─── Report ─────────────────────────────────────────────────────────────────

/** Terminal government state observed after resolution. */
export interface NoConfidenceTerminalGovernment {
  pmCharacterId: string | null;
  pmName: string | null;
  formationStatus: string;
  activeVoteId: string | null;
  /** UK cabinet rows surviving resolution (failed ballot leaves them intact). */
  cabinetMembers: number;
  cooldownRemainingTurns: number;
}

/** Pinned lifecycle report: proposal, in-flight retention, terminal outcome. */
export interface NoConfidenceLifecycleReport {
  heading: string;
  mechanicId: string;
  voteId: string;
  preset: string;
  closesOnTurn: number;
  proposalLines: string[];
  retentionLines: string[];
  terminalLines: string[];
  lines: string[];
}

/**
 * Build the pinned report. The three sections stay distinct so a reader can
 * tell proposal evidence from retention evidence from outcome evidence —
 * never just an aggregate stability number.
 */
export function buildNoConfidenceLifecycleReport(input: {
  voteId: string;
  seed: string;
  turnProposed: number;
  closesOnTurn: number;
  proposerCharacterIdHex: string;
  targetPmName: string;
  retention: RetentionCheck;
  terminal: TerminalCheck;
  government: NoConfidenceTerminalGovernment;
  runUuid: string;
  sourceCommit: string;
}): NoConfidenceLifecycleReport {
  const proposalLines = [
    `seed ${input.seed} turn ${input.turnProposed}: proposer ${input.proposerCharacterIdHex} ` +
      `moved no confidence against ${input.targetPmName} (run ${input.runUuid}, commit ${input.sourceCommit})`,
    `stable vote identity ${input.voteId}, closesOnTurn ${input.closesOnTurn}`,
  ];
  const retentionLines = [`${input.retention.ok ? "RETAINED" : "LOST"}: ${input.retention.reason}`];
  const terminalLines = [
    `${input.terminal.ok ? "RESOLVED" : "UNRESOLVED"}: ${input.terminal.reason}`,
    `government: status=${input.government.formationStatus} pm=${input.government.pmName ?? "vacant"} ` +
      `cabinetMembers=${input.government.cabinetMembers} ` +
      `activeVoteId=${input.government.activeVoteId ?? "null"} ` +
      `cooldownRemaining=${input.government.cooldownRemainingTurns} turns`,
  ];
  return {
    heading: "UK no-confidence lifecycle",
    mechanicId: NO_CONFIDENCE_LIFECYCLE_MECHANIC_ID,
    voteId: input.voteId,
    preset: NO_CONFIDENCE_PRESET,
    closesOnTurn: input.closesOnTurn,
    proposalLines,
    retentionLines,
    terminalLines,
    lines: [
      "UK no-confidence lifecycle (proposal):",
      ...proposalLines,
      "UK no-confidence lifecycle (in-flight retention):",
      ...retentionLines,
      "UK no-confidence lifecycle (terminal outcome):",
      ...terminalLines,
    ],
  };
}
