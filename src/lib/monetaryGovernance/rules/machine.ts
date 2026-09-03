/**
 * Pure monetary governance state machine.
 *
 * One function, decideGovernance, owns every monetary state transition for a
 * currency jurisdiction: board vacancies, chair authority, meeting cadence and
 * resolution, vote tallying, rate-grid normalization, the per-term change cap,
 * cooldown and delta limits, and jurisdiction scoping. Plain data in, plain
 * data out: time arrives as the clock parameter, ids are strings, and the
 * returned transition carries document mutations plus audit events and
 * notifications for the shell to persist and emit.
 *
 * Convention: every refusal carries a short machine-readable reason plus a
 * human message. Replays reuse an "already-..." reason so callers can tell a
 * duplicate submit from a wrong one.
 */

import {
  AGGRESSIVE_CUT_SCRUTINY,
  FOMC_MEETING_INTERVAL_TURNS,
  FOMC_TERM_TURNS,
  FOMC_VACANCY_REMINDER_INTERVAL_TURNS,
  FOMC_VOTE_WINDOW_TURNS,
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  PRIME_RATE_STEP,
  RATE_CHANGES_PER_TERM,
  RATE_CHANGE_COOLDOWN_TURNS,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";
import { INTERFERENCE_SCRUTINY } from "@/lib/centralBank/credibility";
import {
  boardCanCarryMotions as boardCanCarryMotionsLib,
  proposeChairMotion,
  seatPreferredVote,
  tallyMeeting,
  type FomcBallot,
  type FomcSeat,
} from "@/lib/centralBank/fomc";
import type {
  BallotState,
  DeadlineEvent,
  GovernanceActor,
  GovernanceClock,
  GovernanceCommand,
  GovernanceDecision,
  GovernanceInput,
  GovernanceTransition,
  JurisdictionState,
  MacroInputs,
  MeetingState,
  SeatState,
} from "./types";
import { isDeadlineEvent } from "./types";

const PLAYER_VOTE_WINDOW_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

/** Strict majority of the full board; vacant seats count against it. */
export function majorityNeeded(boardSize: number): number {
  return Math.floor(boardSize / 2) + 1;
}

/** Whether the seated (non-vacant) members can still carry a motion. */
export function boardCanCarry(board: SeatState[]): boolean {
  return boardCanCarryMotionsLib(board as unknown as FomcSeat[]);
}

function seatedPlayerSeats(board: SeatState[]): SeatState[] {
  return board.filter((s) => s.occupantType === "player");
}

function chairSeat(board: SeatState[]): SeatState | undefined {
  return board.find((s) => s.isChair) ?? board[0];
}

function vacantCount(board: SeatState[]): number {
  return board.filter((s) => s.occupantType === "vacant").length;
}

function blankTransition(): GovernanceTransition {
  return { set: {}, events: [], notifications: [] };
}

function cloneState(state: JurisdictionState): JurisdictionState {
  return {
    ...state,
    memberCountryIds: [...state.memberCountryIds],
    board: state.board.map((s) => ({ ...s })),
    activeMeeting: state.activeMeeting
      ? { ...state.activeMeeting, ballots: state.activeMeeting.ballots.map((b) => ({ ...b })) }
      : null,
    fxCommitment: state.fxCommitment ? { ...state.fxCommitment } : null,
  };
}

function refuse(reason: string, message: string): GovernanceDecision {
  return { allowed: false, reason, message };
}

/**
 * A command carrying a countryId outside the jurisdiction's membership is
 * refused: the URL's country is only a viewpoint onto the shared institution.
 */
function checkMembership(
  state: JurisdictionState,
  countryId: string | undefined
): GovernanceDecision | null {
  if (countryId && !state.memberCountryIds.includes(countryId)) {
    return refuse(
      "not-member",
      `Country ${countryId} is not a member of the ${state.institutionId} currency area.`
    );
  }
  return null;
}

/** Committee (open / ballot / resolve) actions exist only on committee banks. */
function checkCommitteeBank(state: JurisdictionState): GovernanceDecision | null {
  if (!state.committeeBank) {
    return refuse(
      "no-committee",
      "This central bank has no rate-setting committee: the rate is set directly."
    );
  }
  return null;
}

function rateChangeRefusalFor(fx: JurisdictionState["fxCommitment"]): string | null {
  if (!fx) return null;
  if (fx.regime === "float") return null;
  if (fx.capitalControls) return null;
  return fx.regime === "peg"
    ? "The currency is pegged and the capital account is open, so the policy rate is set by defending the peg."
    : "The currency is committed to an intervention band and the capital account is open, so the policy rate is not independent.";
}

interface ResolveOutcome {
  resolved: boolean;
  moved: boolean;
}

/**
 * Resolve a voting meeting into the transition when it is decided (or the
 * deadline forces it). A decided tally alone never closes a meeting while a
 * seated player can still ballot; the deadline force-resolves with no-shows
 * abstaining. Never resolves a meeting on the turn it opened.
 */
function resolveMeetingInto(
  state: JurisdictionState,
  next: JurisdictionState,
  transition: GovernanceTransition,
  meeting: MeetingState,
  clock: GovernanceClock,
  forceDeadline: boolean
): ResolveOutcome {
  const noChange: ResolveOutcome = { resolved: false, moved: false };
  if (meeting.status !== "voting") return noChange;
  if (meeting.openedAtTurn >= clock.turn) return noChange;

  const tally = tallyMeeting(
    meeting.ballots as unknown as FomcBallot[],
    meeting.motion,
    next.board.length
  );
  const awaitingPlayer = seatedPlayerSeats(next.board).some(
    (s) => !meeting.ballots.some((b) => b.seatId === s.seatId)
  );
  if ((!tally.decided || awaitingPlayer) && !forceDeadline) return noChange;

  const passed = tally.passed;
  const moved = passed && meeting.motion !== "hold" && Math.abs(meeting.proposedDelta) > EPSILON;
  const resolved: MeetingState = {
    ...meeting,
    status: "resolved",
    result: passed ? "passed" : "failed",
    resolvedAtTurn: clock.turn,
    resolvedAtMs: clock.now,
  };

  if (moved) {
    // Normalize both sides of the arithmetic onto the quarter-point grid
    // before validating: a stored off-grid rate must never lock out the next
    // valid on-grid action.
    const previousRate = snapToPrimeRateGrid(state.primeRate);
    const newRate = snapToPrimeRateGrid(previousRate + meeting.proposedDelta);
    const chair = chairSeat(next.board);
    next.primeRate = newRate;
    next.lastRateChangeTurn = clock.turn;
    next.rateChangesThisTerm = state.rateChangesThisTerm + 1;
    transition.set.primeRate = newRate;
    transition.set.lastRateChangeTurn = clock.turn;
    transition.set.rateChangesThisTerm = next.rateChangesThisTerm;
    transition.set.rateHistoryAppend = {
      previousRate,
      newRate,
      changedBy: chair?.characterId ?? "system",
      changedByName: "FOMC",
      changedAtMs: clock.now,
      reason: `FOMC ${meeting.motion} carried ${tally.agree}-${tally.disagree}`,
    };
    transition.events.push({
      kind: "policy.rate_changed",
      command: "monetary.meeting.resolve",
      turn: clock.turn,
      outcome: "ok",
      bankId: state.institutionId,
      subjectType: "meeting",
      subjectId: meeting.meetingId,
      statusBefore: String(previousRate),
      statusAfter: String(newRate),
      meta: {
        previousRate,
        newRate,
        motion: meeting.motion,
        changesThisTerm: next.rateChangesThisTerm,
      },
    });
  }

  next.activeMeeting = null;
  transition.set.activeFomcMeeting = null;
  transition.set.meetingHistoryAppend = resolved;
  transition.events.push({
    kind: "meeting.transitioned",
    command: "monetary.meeting.resolve",
    turn: clock.turn,
    outcome: "ok",
    bankId: state.institutionId,
    subjectType: "meeting",
    subjectId: meeting.meetingId,
    statusBefore: "voting",
    statusAfter: "resolved",
    meta: {
      motion: meeting.motion,
      result: passed ? "passed" : "failed",
      agree: tally.agree,
      disagree: tally.disagree,
      abstain: tally.abstain,
      forcedDeadline: forceDeadline,
      moved,
    },
  });
  return { resolved: true, moved };
}

/** Whether the per-term budget, cooldown and command economy allow a move now. */
function canChangeRate(state: JurisdictionState, turn: number): boolean {
  if (state.commandEconomy) return false;
  if (state.rateChangesThisTerm >= RATE_CHANGES_PER_TERM) return false;
  const last = state.lastRateChangeTurn;
  if (typeof last === "number" && turn - last < RATE_CHANGE_COOLDOWN_TURNS) return false;
  return true;
}

function macroContext(
  macro: MacroInputs,
  currentRate: number
): MacroInputs & { currentRate: number } {
  return { ...macro, currentRate };
}

/**
 * Table a motion and collect the automatic ballots. NPP seats vote their own
 * preference immediately; player seats vote live and vacant seats abstain.
 */
function buildMeeting(
  state: JurisdictionState,
  board: SeatState[],
  macro: MacroInputs,
  clock: GovernanceClock,
  allowChange: boolean
): MeetingState {
  const chair = chairSeat(board);
  const ctx = macroContext(macro, snapToPrimeRateGrid(state.primeRate));
  const { motion, proposedDelta } = proposeChairMotion(chair?.alignment ?? "hawk", ctx, {
    canChangeRate: allowChange,
  });
  const ballots: BallotState[] = [];
  for (const seat of board) {
    if (seat.occupantType === "npp") {
      ballots.push({
        seatId: seat.seatId,
        vote: seatPreferredVote(seat.alignment, ctx),
        auto: true,
      });
    }
  }
  return {
    meetingId: `${state.institutionId}-m${clock.turn}`,
    openedAtTurn: clock.turn,
    motion,
    proposedDelta,
    status: "voting",
    ballots,
    resolvesOnTurn: clock.turn + FOMC_VOTE_WINDOW_TURNS,
    playerVoteDeadlineMs: clock.now + PLAYER_VOTE_WINDOW_MS,
  };
}

function openMeetingInto(
  state: JurisdictionState,
  next: JurisdictionState,
  transition: GovernanceTransition,
  macro: MacroInputs,
  clock: GovernanceClock
): MeetingState {
  const allowChange = canChangeRate(next, clock.turn);
  const meeting = buildMeeting(state, next.board, macro, clock, allowChange);
  next.activeMeeting = meeting;
  next.lastMeetingTurn = clock.turn;
  transition.set.activeFomcMeeting = meeting;
  transition.set.lastFomcMeetingTurn = clock.turn;
  transition.events.push({
    kind: "meeting.transitioned",
    command: "monetary.meeting.open",
    turn: clock.turn,
    outcome: "ok",
    bankId: state.institutionId,
    subjectType: "meeting",
    subjectId: meeting.meetingId,
    statusBefore: "none",
    statusAfter: "voting",
    meta: {
      motion: meeting.motion,
      proposedDelta: meeting.proposedDelta,
      resolvesOnTurn: meeting.resolvesOnTurn,
      canChangeRate: allowChange,
    },
  });
  return meeting;
}

/** Vacate every seat whose staggered term has expired. No auto-seating. */
function expireSeats(
  next: JurisdictionState,
  transition: GovernanceTransition,
  clock: GovernanceClock
): { replaced: number; chairRefreshed: boolean } {
  let replaced = 0;
  let chairRefreshed = false;
  next.board = next.board.map((seat) => {
    if (seat.termExpiresAtTurn != null && seat.termExpiresAtTurn <= clock.turn) {
      replaced++;
      if (seat.isChair) chairRefreshed = true;
      return {
        ...seat,
        occupantType: "vacant" as const,
        characterId: null,
        termExpiresAtTurn: null,
      };
    }
    return seat;
  });
  if (replaced > 0) transition.set.fomcBoard = next.board;
  return { replaced, chairRefreshed };
}

/**
 * Mirror the board's chair seat onto the bank's single-chair fields. A vacant
 * chair clears the person fields and flags the vacancy for the selection
 * pipeline, unless a player offer is already pending.
 */
function mirrorChair(
  next: JurisdictionState,
  transition: GovernanceTransition,
  chairRefreshed: boolean
): void {
  const chair = chairSeat(next.board);
  if (!chair) return;
  transition.set.chairAlignment = chair.alignment;
  transition.set.chairTermExpiresAtTurn = chair.termExpiresAtTurn;
  if (chair.occupantType === "player" && chair.characterId) {
    next.chairCharacterId = chair.characterId;
    transition.set.chairMode = "character";
    transition.set.chairCharacterId = chair.characterId;
    transition.set.chairNppId = null;
  } else if (chair.occupantType === "vacant") {
    next.chairCharacterId = null;
    transition.set.chairCharacterId = null;
    transition.set.chairNppId = null;
    transition.set.chairCharacterName = null;
    if (chairRefreshed && !next.chairSelectionPending) {
      transition.set.vacancyAwaitingAutomaticSelection = true;
      transition.set.chairTermExpiresAtTurn = null;
    }
  } else {
    next.chairCharacterId = null;
    transition.set.chairMode = "npp";
    transition.set.chairCharacterId = null;
    transition.set.chairCharacterName = null;
  }
}

function maybeVacancyNotice(
  state: JurisdictionState,
  next: JurisdictionState,
  transition: GovernanceTransition,
  clock: GovernanceClock,
  seatsExpired: boolean,
  hasActiveNomination: boolean
): void {
  const vacant = vacantCount(next.board);
  if (vacant === 0 || !next.committeeBank) return;
  const last = next.lastVacancyNoticeAtTurn;
  const due =
    seatsExpired ||
    typeof last !== "number" ||
    clock.turn - last >= FOMC_VACANCY_REMINDER_INTERVAL_TURNS;
  if (!due || hasActiveNomination) return;
  next.lastVacancyNoticeAtTurn = clock.turn;
  transition.set.lastFomcVacancyNoticeAtTurn = clock.turn;
  transition.notifications.push({
    kind: "vacancy_notice",
    vacantCount: vacant,
    boardSize: next.board.length,
    chairHoldsRate: !boardCanCarry(next.board),
    stampNoticeTurn: clock.turn,
  });
}

function maybeRollTerm(
  next: JurisdictionState,
  transition: GovernanceTransition,
  clock: GovernanceClock
): void {
  const start = next.termStartedAtTurn;
  if (typeof start !== "number") {
    next.termStartedAtTurn = clock.turn;
    transition.set.fomcTermStartedAtTurn = clock.turn;
  } else if (clock.turn - start >= FOMC_TERM_TURNS) {
    next.termStartedAtTurn = clock.turn;
    next.rateChangesThisTerm = 0;
    transition.set.fomcTermStartedAtTurn = clock.turn;
    transition.set.rateChangesThisTerm = 0;
  }
}

function deadlineHit(meeting: MeetingState, clock: GovernanceClock): boolean {
  return clock.turn >= meeting.resolvesOnTurn || clock.now >= meeting.playerVoteDeadlineMs;
}

function handleTurnStart(
  state: JurisdictionState,
  event: DeadlineEvent,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, event.countryId);
  if (membership) return membership;
  const next = cloneState(state);
  const transition = blankTransition();

  const { replaced, chairRefreshed } = expireSeats(next, transition, clock);
  if (replaced > 0) mirrorChair(next, transition, chairRefreshed);
  maybeVacancyNotice(
    state,
    next,
    transition,
    clock,
    replaced > 0,
    event.hasActiveNomination === true
  );
  maybeRollTerm(next, transition, clock);

  // A government-controlled bank holds no rate meetings even if a board
  // document survives: the committee is dormant until independence returns.
  if (next.governmentControlled) {
    return { allowed: true, next, transition };
  }

  // Only open when no meeting was active at turn start: a meeting that just
  // resolved this turn does not immediately re-open in the same turn.
  const hadActiveMeeting = next.activeMeeting != null;
  const meeting = next.activeMeeting;
  if (meeting && meeting.status === "voting") {
    resolveMeetingInto(state, next, transition, meeting, clock, deadlineHit(meeting, clock));
  }

  if (!hadActiveMeeting && !next.activeMeeting && event.macro && boardCanCarry(next.board)) {
    const last = next.lastMeetingTurn;
    const due = typeof last !== "number" || clock.turn - last >= FOMC_MEETING_INTERVAL_TURNS;
    if (due) openMeetingInto(state, next, transition, event.macro, clock);
  }

  return { allowed: true, next, transition };
}

function handleMeetingDeadline(
  state: JurisdictionState,
  event: DeadlineEvent,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, event.countryId);
  if (membership) return membership;
  const committee = checkCommitteeBank(state);
  if (committee) return committee;
  const next = cloneState(state);
  const transition = blankTransition();
  const meeting = next.activeMeeting;
  if (!meeting || meeting.status !== "voting") {
    return refuse("already-resolved", "No meeting is taking votes. It already resolved.");
  }
  resolveMeetingInto(state, next, transition, meeting, clock, deadlineHit(meeting, clock));
  return { allowed: true, next, transition };
}

function handleOpenMeeting(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "open_meeting" }>,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  const committee = checkCommitteeBank(state);
  if (committee) return committee;
  if (state.governmentControlled) {
    return refuse(
      "government-controlled",
      "The committee is dormant while the government sets the rate."
    );
  }
  if (state.activeMeeting && state.activeMeeting.status === "voting") {
    return refuse("already-open", "A meeting is already taking votes.");
  }
  if (!boardCanCarry(state.board)) {
    return refuse(
      "dead-board",
      "The board cannot carry a motion: too few seated members. The chair holds the rate until seats are filled."
    );
  }
  const last = state.lastMeetingTurn;
  if (typeof last === "number" && clock.turn - last < FOMC_MEETING_INTERVAL_TURNS) {
    return refuse(
      "too-soon",
      `The next meeting opens on turn ${last + FOMC_MEETING_INTERVAL_TURNS}.`
    );
  }
  const next = cloneState(state);
  const transition = blankTransition();
  maybeRollTerm(next, transition, clock);
  openMeetingInto(state, next, transition, command.macro, clock);
  return { allowed: true, next, transition };
}

function handleCastBallot(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "cast_ballot" }>,
  actor: GovernanceActor,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  const committee = checkCommitteeBank(state);
  if (committee) return committee;
  const meeting = state.activeMeeting;
  if (!meeting || meeting.status !== "voting") {
    return refuse("no-meeting", "No meeting is currently taking votes.");
  }
  if (clock.turn > meeting.resolvesOnTurn || clock.now >= meeting.playerVoteDeadlineMs) {
    return refuse("deadline-passed", "The vote window closed. No-shows abstain.");
  }
  const seatId = command.seatId || actor.seatId;
  const seat = state.board.find((s) => s.seatId === seatId);
  if (!seat || seat.occupantType !== "player") {
    return refuse("not-seated", "Only a seated player board member can ballot.");
  }
  if (actor.characterId && seat.characterId && actor.characterId !== seat.characterId) {
    return refuse("not-seated", "You do not hold a seat on this committee.");
  }
  if (meeting.ballots.some((b) => b.seatId === seat.seatId)) {
    return refuse("already-voted", "This seat already voted in this meeting.");
  }
  const next = cloneState(state);
  const transition = blankTransition();
  const updated: MeetingState = {
    ...meeting,
    ballots: [...meeting.ballots, { seatId: seat.seatId, vote: command.vote, auto: false }],
  };
  next.activeMeeting = updated;
  const outcome = resolveMeetingInto(state, next, transition, updated, clock, false);
  if (!outcome.resolved) transition.set.activeFomcMeeting = updated;
  transition.events.push({
    kind: "meeting.voted",
    command: "monetary.meeting.vote",
    turn: clock.turn,
    outcome: "ok",
    bankId: state.institutionId,
    subjectType: "meeting",
    subjectId: meeting.meetingId,
    statusBefore: "voting",
    statusAfter: outcome.resolved ? "resolved" : "voting",
    meta: {
      seatId: seat.seatId,
      vote: command.vote,
      resolved: outcome.resolved,
      moved: outcome.moved,
    },
  });
  return { allowed: true, next, transition };
}

function handleResolveMeeting(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "resolve_meeting" }>,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  const committee = checkCommitteeBank(state);
  if (committee) return committee;
  const meeting = state.activeMeeting;
  if (!meeting || meeting.status !== "voting") {
    return refuse("already-resolved", "No meeting is taking votes. It already resolved.");
  }
  if (meeting.openedAtTurn >= clock.turn) {
    return refuse("too-early", "A meeting never resolves on the turn it opened.");
  }
  const next = cloneState(state);
  const transition = blankTransition();
  const force = command.force === true || deadlineHit(meeting, clock);
  const outcome = resolveMeetingInto(state, next, transition, meeting, clock, force);
  if (!outcome.resolved) {
    return refuse("not-ready", "Votes are still open: undecided, or a player ballot is pending.");
  }
  return { allowed: true, next, transition };
}

function setRateAuthority(
  state: JurisdictionState,
  actor: GovernanceActor
): { ok: true } | { ok: false; reason: string; message: string } {
  if (actor.kind === "admin") return { ok: true };
  if (state.governmentControlled) {
    if (actor.kind === "government") return { ok: true };
    return {
      ok: false,
      reason: "not-authorized",
      message: "This bank has no operational independence: the government sets the rate.",
    };
  }
  if (state.board.length > 0 && boardCanCarry(state.board)) {
    return {
      ok: false,
      reason: "committee-decides",
      message:
        "This central bank has a seated committee: the rate moves by committee vote, not by decree.",
    };
  }
  if (actor.kind === "chair") {
    if (state.controlsLocked) {
      return {
        ok: false,
        reason: "locked",
        message: "Chair controls are locked by an administrator.",
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    reason: "not-authorized",
    message: "Only the current chair can adjust the prime rate.",
  };
}

function handleSetRate(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "set_rate" }>,
  actor: GovernanceActor,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  if (!Number.isFinite(command.rate)) {
    return refuse("invalid-rate", "The requested rate is not a number.");
  }
  // Normalize both sides onto the quarter-point grid before validating, so a
  // stored off-grid rate never locks out the next valid on-grid action.
  const requested = snapToPrimeRateGrid(command.rate);
  const stored = snapToPrimeRateGrid(state.primeRate);
  if (Math.abs(requested - stored) < EPSILON) {
    return refuse("already-at-rate", "The requested rate is already the current rate.");
  }
  if (requested < 0 || requested > 25) {
    return refuse("out-of-range", "The rate must be between 0% and 25%.");
  }
  const authority = setRateAuthority(state, actor);
  if (!authority.ok) return refuse(authority.reason, authority.message);
  if (state.commandEconomy && actor.kind !== "admin") {
    return refuse("command-economy", "A command economy does not set an independent policy rate.");
  }
  const fxRefusal = actor.kind === "admin" ? null : rateChangeRefusalFor(state.fxCommitment);
  if (fxRefusal) return refuse("fx-committed", fxRefusal);
  const delta = requested - stored;
  const isAdmin = actor.kind === "admin";
  if (!isAdmin) {
    if (delta > MAX_RATE_CHANGE_DELTA + EPSILON) {
      return refuse(
        "delta-hike",
        `Rate hikes are limited to +${MAX_RATE_CHANGE_DELTA.toFixed(2)}% per adjustment.`
      );
    }
    if (delta < -(MAX_RATE_CUT_DELTA + EPSILON)) {
      return refuse(
        "delta-cut",
        `Rate cuts are limited to -${MAX_RATE_CUT_DELTA.toFixed(2)}% per adjustment.`
      );
    }
    const last = state.lastRateChangeTurn;
    if (typeof last === "number" && clock.turn - last < RATE_CHANGE_COOLDOWN_TURNS) {
      const wait = RATE_CHANGE_COOLDOWN_TURNS - (clock.turn - last);
      return refuse(
        "cooldown",
        `Rate changes are limited to one every ${RATE_CHANGE_COOLDOWN_TURNS} turns. ${wait} more turn${wait === 1 ? "" : "s"} until the next change.`
      );
    }
    if (state.rateChangesThisTerm >= RATE_CHANGES_PER_TERM) {
      return refuse(
        "term-cap",
        "The per-term rate-change budget is spent. It resets when the term ends."
      );
    }
  }
  const next = cloneState(state);
  const transition = blankTransition();
  const scrutinyApplied = !isAdmin && delta < -(MAX_RATE_CHANGE_DELTA + EPSILON);
  const interferenceApplied = state.governmentControlled && !isAdmin;
  let scrutinyAdded = 0;
  if (scrutinyApplied && !state.governmentControlled) scrutinyAdded += AGGRESSIVE_CUT_SCRUTINY;
  if (interferenceApplied) scrutinyAdded += INTERFERENCE_SCRUTINY;
  next.primeRate = requested;
  next.lastRateChangeTurn = clock.turn;
  transition.set.primeRate = requested;
  transition.set.lastRateChangeTurn = clock.turn;
  if (scrutinyAdded > 0) {
    next.chairInfamy = Math.min(100, state.chairInfamy + scrutinyAdded);
    transition.set.chairInfamy = next.chairInfamy;
  }
  // A direct set on a committee bank still consumes one of the term's moves,
  // so an override cannot hand the committee free changes once it is seated.
  if (state.board.length > 0) {
    next.rateChangesThisTerm = Math.min(RATE_CHANGES_PER_TERM, state.rateChangesThisTerm + 1);
    transition.set.rateChangesThisTerm = next.rateChangesThisTerm;
  }
  transition.set.rateHistoryAppend = {
    previousRate: stored,
    newRate: requested,
    changedBy: actor.characterId ?? "system",
    changedByName: actor.kind,
    changedAtMs: clock.now,
    reason: "direct set",
  };
  transition.events.push({
    kind: "policy.rate_changed",
    command: "monetary.rate.set",
    turn: clock.turn,
    outcome: "ok",
    bankId: state.institutionId,
    subjectType: "centralBank",
    subjectId: state.institutionId,
    statusBefore: String(stored),
    statusAfter: String(requested),
    meta: { previousRate: stored, newRate: requested, scrutinyApplied, interferenceApplied },
  });
  return { allowed: true, next, transition };
}

function handleVacateSeat(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "vacate_seat" }>
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  const seat = state.board.find((s) => s.seatId === command.seatId);
  if (!seat) return refuse("no-such-seat", `There is no seat ${command.seatId}.`);
  if (seat.occupantType === "vacant") {
    return refuse("already-vacant", `Seat ${command.seatId} is already vacant.`);
  }
  const next = cloneState(state);
  const transition = blankTransition();
  next.board = next.board.map((s) =>
    s.seatId === command.seatId
      ? { ...s, occupantType: "vacant" as const, characterId: null, termExpiresAtTurn: null }
      : s
  );
  transition.set.fomcBoard = next.board;
  mirrorChair(next, transition, seat.isChair);
  return { allowed: true, next, transition };
}

function handleInstallSeat(
  state: JurisdictionState,
  command: Extract<GovernanceCommand, { type: "install_seat" }>,
  clock: GovernanceClock
): GovernanceDecision {
  const membership = checkMembership(state, command.countryId);
  if (membership) return membership;
  const slot = state.board.find((s) => s.seatId === command.seat.seatId);
  if (!slot) return refuse("no-such-seat", `There is no seat ${command.seat.seatId}.`);
  if (slot.occupantType !== "vacant") {
    return refuse("already-filled", `Seat ${command.seat.seatId} is already filled.`);
  }
  const next = cloneState(state);
  const transition = blankTransition();
  next.board = next.board.map((s) =>
    s.seatId === command.seat.seatId
      ? { ...command.seat, termExpiresAtTurn: clock.turn + FOMC_TERM_TURNS }
      : s
  );
  transition.set.fomcBoard = next.board;
  mirrorChair(next, transition, false);
  return { allowed: true, next, transition };
}

function handleRollTerm(state: JurisdictionState, clock: GovernanceClock): GovernanceDecision {
  const next = cloneState(state);
  const transition = blankTransition();
  next.termStartedAtTurn = clock.turn;
  next.rateChangesThisTerm = 0;
  transition.set.fomcTermStartedAtTurn = clock.turn;
  transition.set.rateChangesThisTerm = 0;
  return { allowed: true, next, transition };
}

function handleCommand(
  state: JurisdictionState,
  command: GovernanceCommand,
  actor: GovernanceActor,
  clock: GovernanceClock
): GovernanceDecision {
  switch (command.type) {
    case "open_meeting":
      return handleOpenMeeting(state, command, clock);
    case "cast_ballot":
      return handleCastBallot(state, command, actor, clock);
    case "resolve_meeting":
      return handleResolveMeeting(state, command, clock);
    case "set_rate":
      return handleSetRate(state, command, actor, clock);
    case "vacate_seat":
      return handleVacateSeat(state, command);
    case "install_seat":
      return handleInstallSeat(state, command, clock);
    case "roll_term":
      return handleRollTerm(state, clock);
  }
}

/**
 * Decide one governance input against a jurisdiction snapshot. Commands carry
 * an actor; deadline events drive the turn cadence. Returns the next snapshot
 * plus the shell-persistable transition, or a refusal with a reason.
 */
export function decideGovernance(
  state: JurisdictionState,
  input: GovernanceInput,
  actor: GovernanceActor,
  clock: GovernanceClock
): GovernanceDecision {
  if (isDeadlineEvent(input)) {
    const event: DeadlineEvent = input;
    if (event.type === "turn_start") return handleTurnStart(state, event, clock);
    return handleMeetingDeadline(state, event, clock);
  }
  return handleCommand(state, input as GovernanceCommand, actor, clock);
}

/** Next cadence turn: when a fresh meeting may open (null while one is active). */
export function nextCadenceTurn(state: JurisdictionState): number | null {
  if (state.activeMeeting && state.activeMeeting.status === "voting") return null;
  if (typeof state.lastMeetingTurn !== "number") return null;
  return state.lastMeetingTurn + FOMC_MEETING_INTERVAL_TURNS;
}

/**
 * The grid of rates a direct set may pick: quarter-point steps inside the
 * hike and cut deltas around the snapped stored rate, clamped to [0, 25].
 */
export function normalizedRateChoices(state: JurisdictionState): number[] {
  const stored = snapToPrimeRateGrid(state.primeRate);
  const floor = Math.max(0, stored - MAX_RATE_CUT_DELTA);
  const ceiling = Math.min(25, stored + MAX_RATE_CHANGE_DELTA);
  const choices: number[] = [];
  const start = Math.ceil((floor - EPSILON) / PRIME_RATE_STEP) * PRIME_RATE_STEP;
  for (let rate = start; rate <= ceiling + EPSILON; rate += PRIME_RATE_STEP) {
    const snapped = snapToPrimeRateGrid(Math.round(rate * 100) / 100);
    if (snapped + EPSILON >= floor && snapped - EPSILON <= ceiling) choices.push(snapped);
  }
  return choices;
}
