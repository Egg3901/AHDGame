/**
 * Shell translation between centralBanks documents and the monetary
 * governance state machine.
 *
 * The machine works on plain data (string ids, epoch ms); the document works
 * on ObjectIds and Dates. This module converts both ways and materializes a
 * transition's `set` mutations (including history appends with their ring
 * caps) into one updateOne-ready `$set` object. It owns no decisions: every
 * branch lives in the rules.
 */

import { ObjectId } from "mongodb";
import type {
  CentralBank,
  FomcMeeting,
  FomcSeat,
  RateChangeRecord,
} from "@/lib/db/types/centralBank";
import { RATE_HISTORY_MAX } from "@/lib/db/types/centralBank";
import { SYSTEM_RATE_ACTOR } from "@/lib/centralBank/rateHistory";
import type { JurisdictionResolution } from "./jurisdiction";
import type {
  GovernanceTransition,
  JurisdictionState,
  MeetingState,
  SeatState,
} from "./rules/types";

const FOMC_MEETING_HISTORY_MAX = 24;

function idOrNull(value: string | null | undefined): ObjectId | null {
  if (!value) return null;
  try {
    return new ObjectId(value);
  } catch {
    return null;
  }
}

export function seatToState(seat: FomcSeat): SeatState {
  return {
    seatId: seat.seatId,
    isChair: seat.isChair,
    occupantType: seat.occupantType,
    characterId: seat.characterId ? seat.characterId.toString() : null,
    characterName: seat.characterName,
    nppId: seat.nppId ? seat.nppId.toString() : null,
    alignment: seat.alignment,
    appointedByPresidentId: seat.appointedByPresidentId
      ? seat.appointedByPresidentId.toString()
      : null,
    appointedAtTurn: seat.appointedAtTurn,
    termExpiresAtTurn: seat.termExpiresAtTurn,
  };
}

export function meetingToState(meeting: FomcMeeting): MeetingState {
  return {
    meetingId: meeting.meetingId,
    openedAtTurn: meeting.openedAtTurn,
    openedAtMs: meeting.openedAt.getTime(),
    motion: meeting.motion,
    proposedDelta: meeting.proposedDelta,
    status: meeting.status,
    ballots: meeting.ballots.map((b) => ({
      seatId: b.seatId,
      vote: b.vote,
      auto: b.auto,
      castAtMs: b.castAt.getTime(),
    })),
    resolvesOnTurn: meeting.resolvesOnTurn,
    playerVoteDeadlineMs: meeting.playerVoteDeadline.getTime(),
    ...(meeting.result ? { result: meeting.result } : {}),
    ...(typeof meeting.resolvedAtTurn === "number"
      ? { resolvedAtTurn: meeting.resolvedAtTurn }
      : {}),
    ...(meeting.resolvedAt ? { resolvedAtMs: meeting.resolvedAt.getTime() } : {}),
  };
}

export interface StateContext {
  jurisdiction: JurisdictionResolution;
  governmentControlled: boolean;
  fxCommitment: JurisdictionState["fxCommitment"];
  commandEconomy: boolean;
}

export function bankToJurisdictionState(bank: CentralBank, ctx: StateContext): JurisdictionState {
  const board = (bank.fomcBoard ?? []).map(seatToState);
  return {
    institutionId: bank._id,
    currency: ctx.jurisdiction.currency,
    memberCountryIds: ctx.jurisdiction.memberCountryIds,
    anchorCountryId: ctx.jurisdiction.anchorCountryId,
    // A seated board keeps running the committee model even where the
    // jurisdiction would not seed one; exposure stays US-gated in the routes.
    committeeBank: ctx.jurisdiction.committeeBank || board.length > 0,
    governmentControlled: ctx.governmentControlled,
    primeRate: bank.primeRate,
    chairInfamy: bank.chairInfamy,
    board,
    activeMeeting: bank.activeFomcMeeting ? meetingToState(bank.activeFomcMeeting) : null,
    rateChangesThisTerm: bank.rateChangesThisTerm ?? 0,
    termStartedAtTurn: bank.fomcTermStartedAtTurn ?? null,
    lastMeetingTurn: bank.lastFomcMeetingTurn ?? null,
    lastRateChangeTurn: bank.lastRateChangeTurn ?? null,
    chairCharacterId: bank.chairCharacterId ? bank.chairCharacterId.toString() : null,
    controlsLocked: bank.chairControlsLocked === true,
    chairSelectionPending: bank.chairSelectionPending != null,
    fxCommitment: ctx.fxCommitment,
    commandEconomy: ctx.commandEconomy,
    lastVacancyNoticeAtTurn: bank.lastFomcVacancyNoticeAtTurn ?? null,
  };
}

export function stateToSeat(seat: SeatState): FomcSeat {
  return {
    seatId: seat.seatId,
    isChair: seat.isChair,
    occupantType: seat.occupantType,
    characterId: idOrNull(seat.characterId),
    characterName: seat.characterName ?? null,
    nppId: idOrNull(seat.nppId),
    alignment: seat.alignment,
    appointedByPresidentId: idOrNull(seat.appointedByPresidentId),
    appointedAtTurn: seat.appointedAtTurn ?? null,
    termExpiresAtTurn: seat.termExpiresAtTurn,
  };
}

export function stateToMeeting(meeting: MeetingState, now: Date): FomcMeeting {
  return {
    meetingId: meeting.meetingId,
    openedAtTurn: meeting.openedAtTurn,
    openedAt: meeting.openedAtMs != null ? new Date(meeting.openedAtMs) : now,
    motion: meeting.motion,
    proposedDelta: meeting.proposedDelta,
    status: meeting.status,
    ballots: meeting.ballots.map((b) => ({
      seatId: b.seatId,
      vote: b.vote,
      auto: b.auto,
      castAt: b.castAtMs != null ? new Date(b.castAtMs) : now,
    })),
    playerVoteDeadline: new Date(meeting.playerVoteDeadlineMs),
    resolvesOnTurn: meeting.resolvesOnTurn,
    ...(meeting.result ? { result: meeting.result } : {}),
    ...(meeting.resolvedAtMs != null ? { resolvedAt: new Date(meeting.resolvedAtMs) } : {}),
    ...(typeof meeting.resolvedAtTurn === "number"
      ? { resolvedAtTurn: meeting.resolvedAtTurn }
      : {}),
  };
}

export interface RateHistoryAppend {
  previousRate: number;
  newRate: number;
  changedBy: string;
  changedByName: string;
  changedAtMs: number;
  reason?: string;
}

function toRateRecord(append: RateHistoryAppend): RateChangeRecord {
  return {
    previousRate: append.previousRate,
    newRate: append.newRate,
    changedBy: idOrNull(append.changedBy) ?? SYSTEM_RATE_ACTOR,
    changedByName: append.changedByName,
    changedAt: new Date(append.changedAtMs),
    ...(append.reason ? { reason: append.reason } : {}),
  };
}

/**
 * Materialize a transition into document mutations. History appends are
 * folded into full arrays against the loaded bank with the shared ring caps,
 * so the shell persists with one updateOne.
 */
export function materializeTransitionSet(
  bank: CentralBank,
  transition: GovernanceTransition,
  now: Date
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(transition.set)) {
    switch (key) {
      case "fomcBoard":
        set.fomcBoard = (value as SeatState[]).map(stateToSeat);
        break;
      case "activeFomcMeeting":
        set.activeFomcMeeting = value == null ? null : stateToMeeting(value as MeetingState, now);
        break;
      case "meetingHistoryAppend":
        set.fomcMeetingHistory = [
          ...(bank.fomcMeetingHistory ?? []),
          stateToMeeting(value as MeetingState, now),
        ].slice(-FOMC_MEETING_HISTORY_MAX);
        break;
      case "rateHistoryAppend":
        set.rateHistory = [
          ...(bank.rateHistory ?? []),
          toRateRecord(value as RateHistoryAppend),
        ].slice(-RATE_HISTORY_MAX);
        break;
      case "chairCharacterId":
        set.chairCharacterId = idOrNull(value as string | null);
        break;
      case "chairNppId":
        set.chairNppId = idOrNull(value as string | null);
        break;
      default:
        set[key] = value;
    }
  }
  return set;
}
