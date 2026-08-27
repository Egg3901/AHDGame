import type { ObjectId } from "mongodb";
import type { SenateClass } from "./officials";
import type { CountryId } from "../../constants/countries";

/**
 * Known US election types. Still valid values for `Election.electionType`.
 * The field itself is widened to `string` on the interface to allow UK and
 * future country election types (e.g. "commons", "holyrood") without
 * expanding this union.
 */
export type ElectionType = "senate" | "house" | "stateSenate" | "governor" | "president";

/**
 * Known UK election types.
 * "commons" — Westminster general election constituency
 * "primeMinister" — PM selection (coalition/confidence vote)
 * "holyrood" — Scottish Parliament (future)
 * "senedd"   — Welsh Parliament (future)
 * "regionalCouncil" — UK regional council elections (five annual cohorts)
 */
export type UKElectionType =
  "commons" | "primeMinister" | "holyrood" | "senedd" | "regionalCouncil";

export type ElectionStatus = "upcoming" | "active" | "completed" | "resolved" | "cancelled";

export interface Election {
  _id: ObjectId;
  countryId: CountryId;
  /**
   * The type of election. US values: ElectionType union.
   * UK values: UKElectionType union.
   * Widened to string to allow new countries without modifying these unions.
   */
  electionType: ElectionType | UKElectionType | string;
  state: string;
  senateClass?: SenateClass;
  /** Chamber class for multi-seat staggered elections (e.g. JP Sangiin Class 1/2). Separate from senateClass to avoid conflating single-seat US Senate with proportional JP upper chamber. */
  chamberClass?: 1 | 2;
  seatId?: string; // e.g. "US-senate-PA-1" — backfilled in migration
  cycle: number;
  /**
   * LARP calendar year of this election cycle, baked at spawn time from the
   * GameState preset's canonical anchors. Lets the UI label races consistently
   * (e.g. "1993 NPC Delegate" under 1991-default vs "2023 NPC Delegate" under
   * 2019-default) without re-deriving from cycle + preset at every read site.
   * Optional for legacy/un-backfilled rows — display sites fall back to
   * `electionToLarpYear(electionType, cycle, …, ctx)` when absent.
   */
  electionYear?: number;
  status: ElectionStatus;
  /** Temporary guard to prevent concurrent resolution processes from corrupting office data. */
  resolving?: boolean;
  totalSeats?: number;
  startTime?: Date;
  endTime?: Date;
  primaryEndTime?: Date;
  /** Game turns on which the election starts / primary closes / general closes.
   *  Server resolution prefers these so phase transitions don't drift with
   *  real-clock vs game-clock divergence. Optional during the transition;
   *  new elections set both. */
  startTurn?: number;
  endTurn?: number;
  primaryEndTurn?: number;
  durationHours?: number;
  primaryDurationHours?: number;
  /**
   * Presidential ruleset the race is frozen to (stamped at spawn; see
   * elections/presidentialRuleset.ts). Absent on races that predate the seam,
   * which resolve to v1.
   */
  rulesetVersion?: number;
  /** Campaign Here boosts: districtIndex → partySeqId → active boost % (0..7.5). */
  districtCampaignBoosts?: Record<string, Record<string, number>>;
  /**
   * True when this snap was IMPOSED by a peace settlement's regime change rather
   * than called from inside the country.
   *
   * Read by the perpetual spawner. A prime minister's snap drags the LARP calendar
   * forward, so the next regular race anchors to the snap's end turn; an imposed
   * one must not, because dissolving a chamber is the settlement's business and
   * rescheduling every future election is not. Absent on every other election.
   */
  imposedSnap?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CandidateStatus = "active" | "withdrawn";

export interface ElectionCandidate {
  _id: ObjectId;
  electionId: ObjectId;
  /** Denormalized from Election.countryId so party IDs are not ambiguous across countries. */
  countryId?: CountryId;
  characterId: ObjectId;
  characterName: string;
  party: string;
  status: CandidateStatus;
  seatsRequested?: number;
  isNPP?: boolean;
  nppId?: ObjectId;
  enteredAt: Date;
  /**
   * Phase 0.5 §3.1 canonical Support store — short-term candidate mood / momentum,
   * 0..100. Read by Phase 5a's `supportMoodMultiplier` in general-election vote
   * distribution; written by Phase 4 primary resolution and Phase 5b campaign /
   * polling actions. Undefined on pre-Phase-4 rows (degrades to neutral 1.0× in
   * the formula).
   */
  support?: number;
  withdrawnAt?: Date;
  /** For president: running mate character ID. Cannot be current President. */
  runningMateId?: ObjectId;
  /** 2-char US state abbreviation (e.g. "CA", "TX") — for presidential travel system */
  travelState?: string | null;
  /** When the travel was last set */
  traveledAt?: Date;
  /**
   * President-general-only: state the ticket's running mate is campaigning in as
   * a surrogate. Set on the NOMINEE's candidate row (the running mate has no
   * candidate row of their own). Adds the ruleset's vpTravelPresenceWeight to the
   * ticket's per-turn travel-presence favorability. Optional/undefined until the
   * running mate travels; degrades to no bonus on read.
   */
  runningMateTravelState?: string | null;
  /** When the running mate's surrogate travel state was last set. */
  runningMateTraveledAt?: Date | null;
  /**
   * President-primary-only: state the candidate is campaigning in during the primary phase.
   * Badge-only (does NOT relocate the character). Cleared when primary ends.
   */
  primaryCampaignState?: string | null;
  /** When primaryCampaignState was last set. */
  primaryCampaignedAt?: Date;
  /**
   * Ticking in-state primary bonus applied to the projection for `primaryCampaignState`.
   * Increments +1 per turn while camped, capped at PRIMARY_CAMPAIGN_TICK_CAP (5).
   * Resets to 0 on state change.
   */
  primaryCampaignTicks?: number;
  /**
   * True after this candidate has triggered the one-per-cycle home-state surge
   * action during this presidential primary. Cleared at primary resolution.
   */
  primarySurgeUsed?: boolean;
  /**
   * Percentage bonus applied to this candidate's votes ONLY in their home
   * state during primary projection + stagger. Set by the home-state surge
   * action (default 15 = +15%). Applies only while the primary is active;
   * cleared at primary resolution. Candidate-specific so the surge advantages
   * the surging candidate (unlike StatePartyOrg which affects everyone).
   */
  primarySurgeBoost?: number;

  /**
   * Phase B — queued Support drips from rally events. Each entry is one
   * trailing-share payout (`amountPerTurn` Support points / turn for
   * `turnsRemaining` more turns). The accrual-tick processor applies and
   * decrements each entry every turn; entries with `turnsRemaining === 0`
   * are pruned. Undefined / empty = no pending drips. See
   * `2026-05-22-swing-flow-driver-activation.md` §B1.
   */
  supportAccrual?: Array<{
    amountPerTurn: number;
    turnsRemaining: number;
  }>;

  /**
   * Phase B — turn number of the most recently fired one-shot rally
   * action. Used to throttle the rally button (one one-shot per turn
   * per candidate). Tour ticks DO NOT update this field — they run
   * automatically when the tour is active, not via the one-shot
   * action button.
   */
  lastRallyTurn?: number;

  /**
   * Phase B — when set, the rally tour is active for this candidate
   * and the per-turn campaign processor queues a fresh rally event
   * every turn. Stop the tour by unsetting (the trailing accrual still
   * fades naturally).
   */
  rallyTourActive?: boolean;

  /**
   * Presidential general-election only: nominee suspended active campaigning
   * and endorsed another ticket. The candidate stays on the ballot; 25% of
   * campaign strength transfers immediately (one-time), and 25% of per-state
   * character org boosts the endorsed nominee's electoral vote math each turn
   * (no org debited from the suspender). Suspender retains existing votes but
   * stops further accumulation.
   */
  campaignSuspended?: boolean;
  suspendedAt?: Date;
  /** ElectionCandidate._id of the endorsed nominee. */
  endorsedElectionCandidateId?: ObjectId;
  /** Set when the endorsed nominee withdraws; transfers stop but suspension remains. */
  endorsementTargetWithdrawnAt?: Date;
}
