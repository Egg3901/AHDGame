/**
 * Player-facing eligibility view over a jurisdiction snapshot.
 *
 * allowedActionsFor answers "what can this actor do right now, and why not"
 * for every governance action, plus the next deadline (the earlier of the
 * meeting deadline and the next cadence turn) and the grid of rates a direct
 * set may pick. Eligibility only: nothing here mutates state.
 */

import {
  RATE_CHANGES_PER_TERM,
  RATE_CHANGE_COOLDOWN_TURNS,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";
import { boardCanCarry, nextCadenceTurn, normalizedRateChoices } from "./machine";
import type { AllowedAction, GovernanceActor, GovernanceClock, JurisdictionState } from "./types";

export interface AllowedActionsView {
  actions: AllowedAction[];
  nextDeadline: { turn: number; kind: "meeting_deadline" | "cadence" } | null;
  normalizedRateChoices: number[];
  primeRateOnGrid: number;
}

function rateAction(
  state: JurisdictionState,
  actor: GovernanceActor,
  clock: GovernanceClock
): AllowedAction {
  const base: AllowedAction = { action: "set_rate", allowed: true };
  if (actor.kind === "admin") return base;
  if (state.governmentControlled) {
    if (actor.kind === "government") return base;
    return { ...base, allowed: false, reason: "The government sets the rate here." };
  }
  if (state.board.length > 0 && boardCanCarry(state.board)) {
    return {
      ...base,
      allowed: false,
      reason: "A seated committee decides: vote in the committee room.",
    };
  }
  if (actor.kind !== "chair") {
    return { ...base, allowed: false, reason: "Only the current chair can adjust the prime rate." };
  }
  if (state.controlsLocked) {
    return { ...base, allowed: false, reason: "Chair controls are locked by an administrator." };
  }
  if (state.commandEconomy) {
    return {
      ...base,
      allowed: false,
      reason: "A command economy sets no independent policy rate.",
    };
  }
  if (
    state.fxCommitment &&
    state.fxCommitment.regime !== "float" &&
    !state.fxCommitment.capitalControls
  ) {
    return {
      ...base,
      allowed: false,
      reason: "The FX commitment sets the rate while the capital account is open.",
    };
  }
  const last = state.lastRateChangeTurn;
  if (typeof last === "number") {
    const wait = RATE_CHANGE_COOLDOWN_TURNS - (clock.turn - last);
    if (wait > 0) {
      return {
        ...base,
        allowed: false,
        reason: `On cooldown: ${wait} more turn${wait === 1 ? "" : "s"}.`,
      };
    }
  }
  if (state.rateChangesThisTerm >= RATE_CHANGES_PER_TERM) {
    return { ...base, allowed: false, reason: "The per-term rate-change budget is spent." };
  }
  return base;
}

function openAction(state: JurisdictionState): AllowedAction {
  const base: AllowedAction = { action: "open_meeting", allowed: true };
  if (!state.committeeBank) {
    return { ...base, allowed: false, reason: "This bank has no committee." };
  }
  if (state.governmentControlled) {
    return {
      ...base,
      allowed: false,
      reason: "The committee is dormant while the government sets the rate.",
    };
  }
  if (state.activeMeeting && state.activeMeeting.status === "voting") {
    return { ...base, allowed: false, reason: "A meeting is already taking votes." };
  }
  if (!boardCanCarry(state.board)) {
    return {
      ...base,
      allowed: false,
      reason: "The board cannot carry a motion until seats are filled.",
    };
  }
  return base;
}

function ballotAction(
  state: JurisdictionState,
  actor: GovernanceActor,
  clock: GovernanceClock
): AllowedAction {
  const base: AllowedAction = { action: "cast_ballot", allowed: true };
  if (!state.committeeBank) {
    return { ...base, allowed: false, reason: "This bank has no committee." };
  }
  const meeting = state.activeMeeting;
  if (!meeting || meeting.status !== "voting") {
    return { ...base, allowed: false, reason: "No meeting is taking votes." };
  }
  base.deadlineTurn = meeting.resolvesOnTurn;
  if (clock.turn > meeting.resolvesOnTurn) {
    return { ...base, allowed: false, reason: "The vote window closed." };
  }
  const seatId = actor.seatId;
  const seat = state.board.find((s) => s.seatId === seatId);
  if (!seat || seat.occupantType !== "player") {
    return { ...base, allowed: false, reason: "Only a seated board member can vote." };
  }
  if (meeting.ballots.some((b) => b.seatId === seat.seatId)) {
    return { ...base, allowed: false, reason: "This seat already voted." };
  }
  return base;
}

function resolveAction(state: JurisdictionState, clock: GovernanceClock): AllowedAction {
  const base: AllowedAction = { action: "resolve_meeting", allowed: true };
  if (!state.committeeBank) {
    return { ...base, allowed: false, reason: "This bank has no committee." };
  }
  const meeting = state.activeMeeting;
  if (!meeting || meeting.status !== "voting") {
    return { ...base, allowed: false, reason: "No meeting is taking votes." };
  }
  base.deadlineTurn = meeting.resolvesOnTurn;
  if (meeting.openedAtTurn >= clock.turn) {
    return { ...base, allowed: false, reason: "A meeting never resolves on the turn it opened." };
  }
  return base;
}

export function allowedActionsFor(
  state: JurisdictionState,
  actor: GovernanceActor,
  clock: GovernanceClock
): AllowedActionsView {
  // A command from outside the membership is refused everywhere.
  const foreign = actor.countryId && !state.memberCountryIds.includes(actor.countryId);
  const actions: AllowedAction[] = [
    openAction(state),
    ballotAction(state, actor, clock),
    resolveAction(state, clock),
    rateAction(state, actor, clock),
  ].map((a) =>
    foreign ? { ...a, allowed: false, reason: `Country ${actor.countryId} is not a member.` } : a
  );

  const cadence = nextCadenceTurn(state);
  const meetingDeadline =
    state.activeMeeting && state.activeMeeting.status === "voting"
      ? state.activeMeeting.resolvesOnTurn
      : null;
  let nextDeadline: AllowedActionsView["nextDeadline"] = null;
  if (meetingDeadline != null && cadence != null) {
    nextDeadline =
      meetingDeadline <= cadence
        ? { turn: meetingDeadline, kind: "meeting_deadline" }
        : { turn: cadence, kind: "cadence" };
  } else if (meetingDeadline != null) {
    nextDeadline = { turn: meetingDeadline, kind: "meeting_deadline" };
  } else if (cadence != null) {
    nextDeadline = { turn: cadence, kind: "cadence" };
  }
  for (const a of actions) {
    if (a.action === "cast_ballot" || a.action === "resolve_meeting") {
      if (a.deadlineTurn == null && meetingDeadline != null) a.deadlineTurn = meetingDeadline;
    }
    if (a.nextDeadline == null && nextDeadline) a.nextDeadline = nextDeadline.turn;
  }

  return {
    actions,
    nextDeadline,
    normalizedRateChoices: normalizedRateChoices(state),
    primeRateOnGrid: snapToPrimeRateGrid(state.primeRate),
  };
}
