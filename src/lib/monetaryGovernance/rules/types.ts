/**
 * Plain-data types for the monetary governance state machine.
 *
 * A JurisdictionState is one currency area's monetary institution (a national
 * bank such as the Fed, or a shared bank such as the ECB) with everything the
 * machine needs to decide authority, cadence, deadlines and rate limits, and
 * nothing else. Ids are strings, money is numbers, time is turn numbers and
 * epoch milliseconds passed in by the caller. The shell (turn phase, API
 * route) translates between these shapes and the centralBanks document.
 */

export type GovernanceActorKind = "chair" | "governor" | "government" | "admin" | "system";

export interface GovernanceActor {
  kind: GovernanceActorKind;
  characterId?: string;
  seatId?: string;
  countryId?: string;
}

export type SeatOccupant = "player" | "npp" | "vacant";

export interface SeatState {
  seatId: string;
  isChair: boolean;
  occupantType: SeatOccupant;
  characterId: string | null;
  alignment: "hawk" | "dove";
  termExpiresAtTurn: number | null;
}

export type VoteDirection = "hike" | "cut" | "hold";

export interface BallotState {
  seatId: string;
  vote: VoteDirection;
  auto: boolean;
}

export interface MeetingState {
  meetingId: string;
  openedAtTurn: number;
  motion: VoteDirection;
  proposedDelta: number;
  status: "voting" | "resolved";
  ballots: BallotState[];
  resolvesOnTurn: number;
  /** Wall-clock deadline as epoch ms (the shell materializes a Date). */
  playerVoteDeadlineMs: number;
  result?: "passed" | "failed";
  resolvedAtTurn?: number;
  resolvedAtMs?: number;
}

export type FxRegimeKind = "float" | "peg" | "band";

export interface FxCommitment {
  regime: FxRegimeKind;
  capitalControls: boolean;
}

export interface MacroInputs {
  neutralRate: number;
  inflationRate: number;
  targetInflation: number;
  gdpGrowth: number;
}

export interface JurisdictionState {
  institutionId: string;
  currency: string;
  memberCountryIds: string[];
  anchorCountryId: string;
  /** True for the US committee institution; committee actions are US-only. */
  committeeBank: boolean;
  governmentControlled: boolean;
  primeRate: number;
  chairInfamy: number;
  board: SeatState[];
  activeMeeting: MeetingState | null;
  rateChangesThisTerm: number;
  termStartedAtTurn: number | null;
  lastMeetingTurn: number | null;
  lastRateChangeTurn: number | null;
  chairCharacterId: string | null;
  controlsLocked: boolean;
  chairSelectionPending: boolean;
  fxCommitment: FxCommitment | null;
  commandEconomy: boolean;
  lastVacancyNoticeAtTurn: number | null;
}

export type GovernanceCommand =
  | { type: "open_meeting"; countryId?: string; macro: MacroInputs }
  | { type: "cast_ballot"; seatId: string; vote: VoteDirection; countryId?: string }
  | { type: "resolve_meeting"; countryId?: string; force?: boolean }
  | { type: "set_rate"; rate: number; countryId?: string }
  | { type: "vacate_seat"; seatId: string; countryId?: string }
  | { type: "install_seat"; seat: SeatState; countryId?: string }
  | { type: "roll_term"; countryId?: string };

export interface DeadlineEvent {
  type: "turn_start" | "meeting_deadline";
  turn: number;
  /** Epoch ms; the shell passes its own clock reading in. */
  now: number;
  macro?: MacroInputs;
  countryId?: string;
  /** True when a nomination is already before the Senate for this bank. */
  hasActiveNomination?: boolean;
}

export type GovernanceInput = GovernanceCommand | DeadlineEvent;

export function isDeadlineEvent(input: GovernanceInput): input is DeadlineEvent {
  return input.type === "turn_start" || input.type === "meeting_deadline";
}

/** Clock the caller passes in; the machine never reads ambient time. */
export interface GovernanceClock {
  turn: number;
  /** Epoch ms. */
  now: number;
  currentYear: number | null;
}

export interface AllowedAction {
  action: "open_meeting" | "cast_ballot" | "resolve_meeting" | "set_rate";
  allowed: boolean;
  reason?: string;
  deadlineTurn?: number;
  nextDeadline?: number;
}

/** Scalar-only audit event input; the shell hands each to emitBankingAuditEvent. */
export interface GovernanceAuditEvent {
  kind: "meeting.transitioned" | "meeting.voted" | "policy.rate_changed";
  command: string;
  turn: number;
  outcome: "ok" | "rejected";
  reason?: string;
  bankId?: string;
  subjectType?: string;
  subjectId?: string;
  statusBefore?: string;
  statusAfter?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface GovernanceNotification {
  kind: "vacancy_notice";
  vacantCount: number;
  boardSize: number;
  chairHoldsRate: boolean;
  stampNoticeTurn: number;
}

export interface GovernanceTransition {
  /** CentralBanks document mutations (plain values; the shell materializes Dates and ids). */
  set: Record<string, unknown>;
  events: GovernanceAuditEvent[];
  notifications: GovernanceNotification[];
}

export type GovernanceDecision =
  | { allowed: true; next: JurisdictionState; transition: GovernanceTransition }
  | { allowed: false; reason: string; message: string };
