import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ChairAlignment } from "@/lib/centralBank/chairAlignment";
import type { IterationStampFields } from "./gameState";

// ── Rate Change History ────────────────────────────────────────────────────────

/** Maximum rate hike (percentage points) per chair action. Also the threshold above which a cut becomes "aggressive". */
export const MAX_RATE_CHANGE_DELTA = 0.75;

/** Dual-mandate Taylor-rule coefficients for the autonomous NPP chair. */
export const NPP_CHAIR_INFLATION_COEF = 1.0;
export const NPP_CHAIR_GROWTH_COEF = 0.5;
/** Fraction of the rate gap to close per eligible turn (dampening to avoid thrash). */
export const NPP_CHAIR_STEP_FRACTION = 0.5;
/** Target real GDP growth for the autonomous chair (matches TARGET_GROWTH in centralBankChairTurn.ts). */
export const NPP_CHAIR_TARGET_GROWTH = 2.0;

/** Maximum rate cut (percentage points) per chair action — chairs may cut more aggressively at the cost of scrutiny. */
export const MAX_RATE_CUT_DELTA = 1.75;

/** Scrutiny (chairInfamy) penalty applied immediately when a chair cuts by more than MAX_RATE_CHANGE_DELTA. */
export const AGGRESSIVE_CUT_SCRUTINY = 10;

/** Number of turns a chair must wait between rate changes. */
export const RATE_CHANGE_COOLDOWN_TURNS = 6;

export interface RateChangeRecord {
  previousRate: number;
  newRate: number;
  changedBy: ObjectId;
  changedByName: string;
  changedAt: Date;
  reason?: string;
}

// ── FOMC Committee ─────────────────────────────────────────────────────────────
//
// The single-chair bank is generalised into a rate-setting committee (FOMC). The
// chair proposes a motion (hike / cut / hold) each meeting; the seated governors
// vote. NPP (technocrat) seats vote automatically off the same Taylor rule the
// autonomous chair uses, tilted by their hawk/dove alignment. Player seats are
// notified and given a real-time window to vote; a no-show counts as an abstain.
// A motion passes only on a majority of the FULL seated board (abstains count
// against it), so the committee is deliberately biased toward holding.

/** Voting seats on the committee (chair included). Odd so majorities are clean. */
export const FOMC_BOARD_SIZE = 7;

/** Hard cap on executed rate changes (hikes + cuts, holds are free) per 4-year term. */
export const RATE_CHANGES_PER_TERM = 16;

/** Turns in a full board/chair term (4 game years × 48 turns/year). Mirrors CHAIR_TERM_TURNS. */
export const FOMC_TERM_TURNS = 192;

/** Turns between scheduled FOMC meetings (48 turns/year ⇒ 6 meetings/game-year). */
export const FOMC_MEETING_INTERVAL_TURNS = 8;

/** Real-time window (ms) a seated player has to cast a ballot before the meeting resolves. */
export const FOMC_PLAYER_VOTE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Game-clock window (turns) matching the 24h wall clock (~1 turn/hour), for meetings and confirmations. */
export const FOMC_VOTE_WINDOW_TURNS = 24;

/** A motion / ballot direction. */
export type FomcVote = "hike" | "cut" | "hold";

/** Who occupies a seat. "vacant" seats abstain and count against the board majority. */
export type FomcOccupantType = "player" | "npp" | "vacant";

/** One governor seat on the committee. */
export interface FomcSeat {
  /** Stable slot id (e.g. "seat-1"). Seat 1 is conventionally the chair. */
  seatId: string;
  isChair: boolean;
  occupantType: FomcOccupantType;
  /** Player / NPP-politician character occupant, if any. */
  characterId: ObjectId | null;
  characterName: string | null;
  /** Technocrat NPP occupant (autonomous voter) when no character is seated. */
  nppId: ObjectId | null;
  /** Monetary temperament driving this seat's auto-vote. */
  alignment: ChairAlignment;
  appointedByPresidentId: ObjectId | null;
  appointedAtTurn: number | null;
  /** Staggered expiry so at most one seat opens per window. */
  termExpiresAtTurn: number | null;
}

/** One cast ballot in the active meeting. */
export interface FomcBallot {
  seatId: string;
  vote: FomcVote;
  /** True when auto-cast by an NPP seat or by no-show fallback; false for a live player vote. */
  auto: boolean;
  castAt: Date;
}

export type FomcMeetingStatus = "voting" | "resolved";

/** A single rate-setting meeting. At most one is active per bank at a time. */
export interface FomcMeeting {
  meetingId: string;
  openedAtTurn: number;
  openedAt: Date;
  /** Chair's proposed motion for this meeting. */
  motion: FomcVote;
  /** Signed pp applied to primeRate if the motion passes (0 for a hold). */
  proposedDelta: number;
  status: FomcMeetingStatus;
  ballots: FomcBallot[];
  /** Wall-clock deadline for player seats. Turn boundary is the hard deadline. */
  playerVoteDeadline: Date;
  /** Game-clock turn on which the meeting force-resolves regardless of pending ballots. */
  resolvesOnTurn: number;
  result?: "passed" | "failed";
  resolvedAt?: Date;
  resolvedAtTurn?: number;
}

/**
 * A President's nomination of a nominee (player, NPP politician, or technocrat)
 * to a specific committee seat. Senate-confirmed via the same lifecycle as
 * cabinet nominations. On confirmation the nominee is installed into the target
 * seat on `fomcBoard`; on rejection the seat is untouched.
 */
export interface FomcNomination extends IterationStampFields {
  _id: ObjectId;
  countryId: CountryId;
  /** centralBanks._id the seat belongs to. */
  bankId: string;
  /** Target seat on fomcBoard. */
  seatId: string;
  /** Nominate into the chair role (also flips the seat's isChair on confirmation). */
  makeChair?: boolean;
  /** Player / NPP-politician nominee (has a character/NPP politician id). */
  nomineeCharacterId: ObjectId | null;
  /** Technocrat NPP nominee. */
  nomineeNppId: ObjectId | null;
  nomineeName: string;
  nomineeParty?: string;
  /** Whether the seat becomes a live player seat or an autonomous NPP seat. */
  occupantType: "player" | "npp";
  /** Hawk/dove temperament the President assigns to the seat. */
  alignment: ChairAlignment;
  proposedByPresidentId: ObjectId;
  proposedByPresidentName: string;
  status: import("./cabinet").CabinetNominationStatus;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  votingStartedAt?: Date;
  votingEndsOnTurn?: number;
  proposedAt: Date;
  confirmedAt?: Date;
  rejectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Central Bank Document ──────────────────────────────────────────────────────

/** Per-turn snapshot for charting a single value over time */
export interface TurnSnapshot {
  turn: number;
  rate: number;
}

/** @deprecated Use TurnSnapshot instead */
export type InterestRateSnapshot = TurnSnapshot;

/** Executive nomination for central bank chair */
export interface CentralBankNomination {
  characterId: ObjectId;
  characterName: string;
  nominatedBy: ObjectId;
  nominatedByName: string;
  nominatedAt: Date;
}

/** Chair selection awaiting the nominee's acceptance (player characters only) */
export interface ChairSelectionPending {
  characterId: ObjectId;
  characterName: string;
  pool: "political" | "economic";
  proposedAt: Date;
  proposedAtTurn: number;
  /** Present when the pending pick came from the executive nomination pool */
  appointedByExecutiveId: ObjectId | null;
  /** Nominees who declined this cycle (used to skip them on re-selection) */
  declinedCharacterIds: ObjectId[];
}

/** Individual lobbying contribution (aggregated for public display) */
export interface CentralBankLobbyEntry {
  targetCharacterId: ObjectId;
  targetCharacterName: string;
  lobbyistCharacterId: ObjectId;
  amount: number;
  createdAt: Date;
}

/** One Treasury → FX reserve transfer entry (ring buffer, last N turns). */
export interface TreasuryTransferRecord {
  turn: number;
  transferredBy: ObjectId;
  transferredByName: string;
  /** Home-currency face value transferred from federal surplus to CB reserveBalance. */
  amount: number;
  justification?: string;
  createdAt: Date;
}

export interface CentralBank {
  /** Country ID (e.g. "US", "UK") — used as _id */
  _id: string;
  countryId: CountryId;
  chairCharacterId: ObjectId | null;
  chairCharacterName: string | null;
  chairAppointedAt: Date | null;
  chairAppointedBy: ObjectId | null;
  /** "character" (player/NPP-politician chair, default) or "npp" (autonomous technocrat chair). */
  chairMode?: "character" | "npp";
  /** ObjectId of the technocrat NPP acting as chair when chairMode === "npp". */
  chairNppId?: import("mongodb").ObjectId | null;
  /**
   * Monetary-policy temperament of the seated chair. Biases the autonomous
   * (chairMode === "npp") Taylor-rule rate setting: a hawk fights inflation
   * harder and is quicker to hike / slower to cut; a dove tolerates inflation
   * for growth and is quicker to cut / slower to hike. Absent ⇒ no bias.
   */
  chairAlignment?: "hawk" | "dove";
  primeRate: number;
  rateHistory: RateChangeRecord[];
  /** Turn number of the chair's most recent rate change. Used to enforce a cooldown between adjustments. */
  lastRateChangeTurn?: number;
  /** Chair infamy (0-100). Ticks up with high inflation / low growth, down with the inverse. */
  chairInfamy: number;
  /** Turn number when the current chair's term expires */
  chairTermExpiresAtTurn: number | null;
  /**
   * FOMC committee seats (chair + governors). Absent on legacy single-chair banks;
   * seeded at iteration start. When present, rate moves are decided by committee vote.
   */
  fomcBoard?: FomcSeat[];
  /** The meeting currently taking votes, if any. */
  activeFomcMeeting?: FomcMeeting | null;
  /** Executed rate changes (hikes + cuts) so far this term. Capped at RATE_CHANGES_PER_TERM. */
  rateChangesThisTerm?: number;
  /** Turn the current committee term began — resets rateChangesThisTerm. */
  fomcTermStartedAtTurn?: number;
  /** Turn of the most recently opened FOMC meeting (paces the meeting cadence). */
  lastFomcMeetingTurn?: number;
  /** Recent resolved meetings (ring buffer) for dissent history / charting. */
  fomcMeetingHistory?: FomcMeeting[];
  /** When set, the next chair must accept before the appointment is finalized */
  chairSelectionPending?: ChairSelectionPending | null;
  /** Executive nominations for the next chair selection */
  nominations: CentralBankNomination[];
  /** Lobbying contributions — individual entries, aggregated for display */
  lobbyingPool: CentralBankLobbyEntry[];
  /** Per-turn snapshots of the interest rate (capped at 48 = 1 game year) */
  interestRateHistory: TurnSnapshot[];
  /** Per-turn snapshots of the inflation rate (capped at 48 = 1 game year) */
  inflationHistory: TurnSnapshot[];
  /** Per-turn snapshots of national GDP growth (capped at 48 = 1 game year) */
  gdpGrowthHistory: TurnSnapshot[];
  /** Mirrored from FederalBudget.economicFactors.tradeGrowth each turn (read-cache) */
  tradeGrowth?: number;
  /** Accumulated spread fee revenue from forex trading (40% of all spreads, home-currency pool). */
  forexRevenue?: number;
  /**
   * The 10% reserve slice of forex spread fees, stored in the currency collected
   * instead of being converted into the central bank's home currency.
   */
  spreadFeeReserveBalances?: Partial<Record<CurrencyCode, number>>;
  /**
   * Accumulated interest payments received from LOC borrowers (home currency face value).
   * Grows each turn as auto-payments are applied against arrears.
   * Combined with nationalSavingsBalance to set the 70% system LOC cap.
   */
  reserveBalance?: number;
  /** Broad deposits belonging to the unmodeled household/business economy. */
  externalBroadMoney?: number;
  /** Lifetime currency created minus currency retired by explicit monetary operations. */
  netMoneyCreatedLifetime?: number;
  /** Recent QE/QT, direct-financing, and liquidity operations. */
  monetaryOperations?: import("./moneySupply").MonetaryOperationRecord[];
  /** Turn of the most recent discretionary monetary operation. */
  lastMonetaryOperationTurn?: number;
  /** Latest autonomous committee assessment, including deliberate holds. */
  lastMonetaryPolicyEvaluation?: import("./moneySupply").MonetaryPolicyEvaluation;
  /**
   * Turn of the chair's most recent forexRevenue ↔ reserveBalance reallocation.
   * Enforces a once-per-real-day (24-turn) cooldown for non-admin chairs.
   */
  lastReservePoolTransferTurn?: number;
  /**
   * Total savings held in this country's currency across all characters.
   * Maintained by savingsInterestTurn each turn. Used by inflationRecalc to
   * normalise the 12-turn net savings flow into a dimensionless pressure signal.
   */
  nationalSavingsBalance?: number;
  /**
   * Net 12-turn savings ledger flow as a percentage of effective stock (–100 to +100).
   * Same dimensionless ratio as inflation inputs, ×100 for display. Positive = net
   * withdrawals (demand-pull); negative = net deposits. Not household savings / GDP.
   * Written each turn by inflationRecalc; read by interestRateSnapshot for charting.
   */
  currentSavingsPressure?: number;
  /**
   * Discretionary monetary-policy inflation pressure (pp), summed each turn from
   * the active central-bank-governor stance + ministerial orders + emergency by
   * `processMinisterialOrders`, then read by `recalculateInflationPerTurn` and the
   * PBoC detail breakdown. Positive = easing, negative = tightening. 0 when no
   * stance/order is active.
   */
  policyInflationPressure?: number;
  /** Per-turn snapshots of the savings-flow pressure % (capped at 48 = 1 game year) */
  savingsFlowHistory?: TurnSnapshot[];
  /**
   * When true, the chair cannot adjust prime rate or use chair-only controls until cleared by an admin.
   */
  chairControlsLocked?: boolean;
  /**
   * Whether monetary policy is set by the government (head of government or the
   * finance seat) rather than by the bank's own chair/committee. Unset means
   * "use the historical default" — resolved by `isBankGovernmentControlled` in
   * `src/lib/centralBank/governance.ts` (UK pre-1997 era starts are
   * government-controlled; everyone else is independent). A
   * `central_bank_independence` bill provision writes this explicitly, and an
   * explicit value always wins over the default.
   */
  governmentControlled?: boolean;
  /**
   * When true, the next chair selection phase should attempt to propose a seated replacement
   * (mid-term resignation, admin vacate, or no-eligible-candidate retry). Omit on initial bootstrap.
   */
  vacancyAwaitingAutomaticSelection?: boolean;
  /**
   * When set, this bank is governed by an international organization rather than
   * one country. Chair nominations and economic pools span member countries.
   */
  intorgId?: string;
  /** Ring buffer of Treasury → FX reserve transfers. Capped at TREASURY_TRANSFER_HISTORY_MAX. */
  treasuryTransferHistory?: TreasuryTransferRecord[];
  /** Guards treasury â†’ reserve transfers against duplicate submits and partial failures. */
  treasuryTransferInProgressAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Credit Rating Scale ────────────────────────────────────────────────────────

export type CreditRating = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC";

/** Basis-point spread above the prime rate for each credit tier */
export const CREDIT_RATING_SPREADS: Record<CreditRating, number> = {
  AAA: 0,
  AA: 0.5,
  A: 1.5,
  BBB: 3,
  BB: 5,
  B: 8,
  CCC: 12,
};

export const CREDIT_RATINGS: CreditRating[] = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"];

/** Returns the effective interest rate for a given prime rate and credit rating */
export function getEffectiveRate(primeRate: number, creditRating: CreditRating): number {
  return Math.round((primeRate + CREDIT_RATING_SPREADS[creditRating]) * 100) / 100;
}

/** Returns the full rate scale mapping each credit rating to its effective rate */
export function getRateScale(primeRate: number): Record<CreditRating, number> {
  const scale = {} as Record<CreditRating, number>;
  for (const rating of CREDIT_RATINGS) {
    scale[rating] = getEffectiveRate(primeRate, rating);
  }
  return scale;
}
