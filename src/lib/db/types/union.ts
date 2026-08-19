import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { UnionServiceId } from "@/lib/unions/unionServices";

/**
 * v3 Phase 8 (`labourSystemMode >= "full"`), a player-run union.
 *
 * Dues v1 changed the scope rule. A union is still scoped to one industry in
 * one country, but there may now be SEVERAL in that pair: players can found a
 * rival in an industry that already has a union. Which sectors a union actually
 * holds is no longer implied by the (countryId, sectorType) match, it is
 * recorded on the sector as `CorporateSector.representingUnionId`, and a
 * targeted organizing drive can take a sector off a rival. Same-industry only:
 * a union never organizes outside its own `sectorType`.
 *
 * The original type-scoped note follows, and still describes how a union's
 * CANDIDATE sectors are found (matching countryId+sectorType) before
 * representation is checked:
 *
 * One Union per (countryId, sectorType) pair, a union organizes an entire
 * industry within a country (e.g. "US Manufacturing Workers"), not a
 * hand-picked list of sectors. Its scope (which `CorporateSector`s it
 * affects) is computed by querying for matching countryId+sectorType at
 * read/action time, not stored as a join table, this maps directly onto
 * the existing per-sector `unionization` stat with no new plumbing.
 *
 * Deliberately NOT a membership-roster social system: "membership" is the
 * abstract `unionization`/`membershipPressure` stat (an NPC worker
 * population), not a roster of player Characters who joined. Player leaders
 * are contested continuously (CEO-style): organizers fund
 * drives until strength crosses a threshold, then vote weighted by banked
 * strength; the plurality winner must accept the offer and may displace a
 * sitting player or NPP president.
 *
 * `ownerId` is the source of truth for who leads this union, see the
 * denormalized `Character.unionLeaderOf` cache in `src/lib/db/types/character.ts`.
 */
export interface Union {
  _id: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType;
  /** Era-appropriate seeded display name (historical where possible, generic fallback). */
  name: string;
  /**
   * Whoever leads this union, or null (unmanned, Phase 5's drift model runs
   * unchanged). Read `ownerType` before resolving the id: it points at
   * `characters` for a player and `npps` for an NPP leader.
   */
  ownerId: ObjectId | null;
  /**
   * Which collection `ownerId` refers to. Absent means `"character"`, so every
   * pre-existing union document keeps its original meaning. Mirrors the
   * `Corporation.ceoId`/`ceoType` pairing.
   */
  ownerType?: "character" | "npp";
  /** Top vote-getter awaiting acceptance, mirrors `Corporation.pendingCeoCharacterId`. */
  pendingLeaderCharacterId?: ObjectId | null;
  /** Spendable balance (home-country currency-equivalent, ₳-anchor), funds recruit/strike actions. Trickles up per turn proportional to `membershipPressure` (the "dues" analog). */
  treasury: number;
  /**
   * Uncapped organizing power, the sum of every organize drive any character
   * has ever run on this union, less decay. Distinct from `membershipPressure`:
   * pressure is shop-floor coverage scored 0-100 and drives unionization drift
   * and dues, while strength is a pool of political muscle that any number of
   * players can pile into. It gates the leadership election and weights the
   * votes in it. Decays `UNION_STRENGTH_DECAY_PER_TURN` every turn. Absent on
   * documents written before organizing v2, which reads as zero.
   */
  strength?: number;
  /**
   * @deprecated Retired by union dues v1. This 0-100 organizing score was the
   * dues base, the unionization drift bias, the strike-capacity gate and the
   * leadership threshold all at once, and players read it as a headcount.
   * Those jobs now belong to `approval` (drift anchor), derived membership
   * (dues base, see `unionMembers()` in `src/lib/unions/unionDues.ts`) and
   * `strength` (leadership). Left on the type only so existing documents
   * deserialize; nothing reads it. A migration drops the field.
   */
  membershipPressure?: number;
  /**
   * 0-100, how the membership rates the bargain they are getting. Dues and
   * political contributions push it down, running services pushes it up
   * (`approvalTarget()` in `src/lib/unions/unionDues.ts`). It anchors the
   * unionization drift target in every sector this union represents, so it
   * governs both whether density holds and whether the union can win new shops.
   * Absent on documents written before dues v1, which reads as `BASE_APPROVAL`.
   */
  approval?: number;
  /**
   * Annual dues charged per member, in the union's home currency. Set by the
   * union head. Stored in money because the player sets a money figure, but
   * always read against the local annual wage before it touches approval, so
   * the same rate means the same thing in Lagos and Detroit.
   */
  duesPerWorkerAnnual?: number;
  /**
   * Service programmes currently switched on, paid for out of the treasury
   * every turn. Unknown ids are ignored on read (`normalizeServiceIds()`), so a
   * stale document cannot widen the effect.
   */
  activeServices?: UnionServiceId[];
  /**
   * Share of this turn's remaining budget (dues income minus the service bill
   * that ran) sent to organizers as political contributions, in [0, 0.5].
   * Paid out per turn in proportion to each organizer's banked strength.
   * Absent on documents written before this lever, which reads as none.
   */
  politicalContributionPct?: number;
  /**
   * Set when a player founded this union rather than the world seeding it.
   * Founded unions are how a rival appears in an industry that already has one,
   * which is what makes raiding possible at all.
   */
  foundedByCharacterId?: ObjectId | null;
  /** Turn a strike was last force-called via this union's `/strike` action, a union-level rate limit, separate from each sector's own `strikeCooldownUntilTurn`. */
  lastCalledStrikeTurn: number | null;
  /** Visible target wageLevel this union is demanding from CEOs in its scope, or null if none set. */
  demandedWageLevel: number | null;
  /**
   * Union ban (player suggestion #93): true while this union's country has
   * `FederalBudget.unionsBanned` set by an enacted ban. Suspended unions are
   * frozen: `processUnionsTurn` skips dues/decay/inactivity-vacancy for them
   * and player actions 403, but the document (leadership, treasury,
   * membershipPressure) is deliberately NEVER deleted, so a repeal restores
   * the union exactly as it was. Set/cleared by `applyUnionLawProvision`
   * (`src/lib/labour/unionLaws.ts`).
   */
  suspended?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * v3 Phase 8: a union's recorded stance on a bill, visibility-only this
 * phase (no mechanical vote-swing effect yet), same "observe first, wire
 * consequences later" precedent Phase 5 set for the unionization metric
 * itself.
 */
export interface UnionEndorsement {
  _id: ObjectId;
  unionId: ObjectId;
  billId: ObjectId;
  stance: "endorse" | "oppose";
  createdAt: Date;
}

/** A character who has organized this union. Banked strength is their voting power in the leadership election. */
export interface UnionOrganizer {
  _id: ObjectId;
  unionId: ObjectId;
  characterId: ObjectId;
  organizeCount: number;
  /**
   * This organizer's share of the union's strength: what their drives added,
   * less the same per-turn decay the union pool takes. This is their vote
   * weight when a president is elected, so leadership follows sustained
   * organizing rather than whoever turned up first. Absent on documents
   * written before organizing v2, which reads as zero.
   */
  strength?: number;
  /** Anchor-equivalent ₳ spent across all organize actions. Legacy: organizing now costs action points, not cash. */
  totalSpent: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One organizer's vote for union president (one vote per organizer per union). */
export interface UnionLeaderVote {
  _id: ObjectId;
  unionId: ObjectId;
  voterCharacterId: ObjectId;
  candidateCharacterId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/** Which side authored an embedded bargaining offer. */
export type BargainingParty = "union" | "employer";

/**
 * A wage and labor-peace package proposed during collective bargaining.
 * Offers are embedded on the campaign so the complete negotiating record is
 * loaded atomically and cannot become detached from its campaign.
 */
export interface BargainingOffer {
  /** Monotonic within one campaign, starting at 1. */
  revision: number;
  proposedBy: BargainingParty;
  wageLevel: number;
  agreementDurationTurns: number;
  noStrikeTurns: number;
  /**
   * A8: employer pension contribution as a share of the covered wage bill.
   * Absent on every offer made before pension bargaining shipped, which reads
   * as zero: those agreements promised no pension and none is charged.
   */
  pensionContributionRate?: number;
  proposedAtTurn: number;
  proposedAt: Date;
}

/**
 * The union's authority and power over the locals in scope. Recomputed from
 * live shop-floor and macro conditions every turn while the campaign is open,
 * so organizing, membership loss, and new union law all move the campaign that
 * is already running instead of only the next one.
 */
export interface BargainingMandate {
  /** Worker-weighted unionization across the locals in scope, 0-100. */
  coverage: number;
  /** Worker grievance produced by the gap between current pay and the claim, 0-100. */
  grievance: number;
  /** Labor-market scarcity supplied by the macro layer, 0-100. */
  laborTightness: number;
  /** Legal support for collective bargaining, normalized to 0-100. */
  lawSupport: number;
  /** How many scoped strike calls the treasury can fund, capped for scoring. */
  strikeFundRunway: number;
  /** Combined member authority for opening and escalating the campaign, 0-100. */
  support: number;
  /** Combined bargaining power used by employer AI and settlement consequences, 0-100. */
  leverage: number;
  organizedLocalCount: number;
  totalLocalCount: number;
}

/**
 * `lapsed` is an unresolved dispute that ran out of time. Neither side can
 * hold the other in an open dispute forever: an employer has no unilateral
 * exit, so the clock is the exit, and it frees the pair to bargain again after
 * a cooling-off period.
 */
export type BargainingCampaignStatus =
  "negotiating" | "dispute" | "settled" | "withdrawn" | "lapsed";

export type BargainingEscalationLevel =
  "none" | "overtime_ban" | "selective_strike" | "industry_strike";

export type BargainingMediationStatus = "pending" | "rejected" | "expired";

/**
 * `void` is a ratification that never got an answer because the thing it was
 * answering stopped existing: the campaign was withdrawn or lapsed under it, or
 * the employer corporation is gone. It is deliberately distinct from
 * `rejected`, which is a decision the members actually took.
 */
export type BargainingRatificationStatus = "open" | "ratified" | "rejected" | "void";

/** One organizer's ballot weight, snapshotted when the vote opened. */
export interface BargainingRatificationWeight {
  characterId: ObjectId;
  strength: number;
}

/**
 * A member ballot on the settlement the president moved to accept. Embedded on
 * the campaign for the same reason the offers are: the record of who was asked
 * and on what terms cannot become detached from the campaign it decided.
 *
 * Weights are a SNAPSHOT taken when the vote opened, not a live read of
 * `UnionOrganizer.strength`. Strength decays every turn
 * (`UNION_STRENGTH_DECAY_PER_TURN`) and new drives add to it, so a live
 * recompute would silently reprice ballots that were already cast and could
 * flip a tally between one organizer voting and the next. It is the same
 * reasoning that snapshots `sectorIds` at opening.
 */
export interface BargainingRatification {
  /** The offer revision the members are answering. */
  offerRevision: number;
  status: BargainingRatificationStatus;
  openedAtTurn: number;
  /** Turn the vote closes on if it has not already been decided. */
  closesAtTurn: number;
  closedAtTurn?: number;
  weights: BargainingRatificationWeight[];
  /** Sum of `weights`, the denominator every majority test uses. */
  totalStrength: number;
  openedAt: Date;
  updatedAt: Date;
}

/** One organizer's ballot in one ratification vote. */
export interface BargainingRatificationBallot {
  _id: ObjectId;
  campaignId: ObjectId;
  /** Ballots are scoped to the offer they answered, so a later offer starts clean. */
  offerRevision: number;
  voterCharacterId: ObjectId;
  vote: "ratify" | "reject";
  createdAt: Date;
  updatedAt: Date;
}

/** A non-binding government conciliation package awaiting the other party. */
export interface BargainingMediation {
  requestedBy: BargainingParty;
  wageLevel: number;
  agreementDurationTurns: number;
  noStrikeTurns: number;
  /** A8: leverage-weighted pension rate, absent when neither side asked for one. */
  pensionContributionRate?: number;
  unionAccepted: boolean;
  employerAccepted: boolean;
  status: BargainingMediationStatus;
  proposedAtTurn: number;
  expiresAtTurn: number;
  proposedAt: Date;
  updatedAt: Date;
}

/**
 * One union bargaining with one employer corporation over all matching locals
 * in that corporation. The sector ids are snapshotted at opening so neither
 * party can change the deal's scope by buying, selling, or creating a sector
 * while negotiations are underway.
 */
export interface BargainingCampaign {
  _id: ObjectId;
  unionId: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType;
  employerCorporationId: ObjectId;
  sectorIds: ObjectId[];
  status: BargainingCampaignStatus;
  escalationLevel: BargainingEscalationLevel;
  mandate: BargainingMandate;
  /** Turn the mandate was last recomputed from live conditions. */
  mandateUpdatedAtTurn?: number;
  /**
   * Shop-floor expectations as they stood before this campaign forced them up
   * to call a strike. Restored when the campaign ends so a single escalation
   * cannot leave a permanent strike generator behind on the locals.
   */
  escalationExpectations?: {
    sectorId: ObjectId;
    previousExpectationIndex: number | null;
  }[];
  currentOffer: BargainingOffer;
  offers: BargainingOffer[];
  startedAtTurn: number;
  deadlineTurn: number;
  lastActionTurn: number;
  disputeStartedAtTurn?: number;
  escalationStartedAtTurn?: number;
  mediation?: BargainingMediation;
  /**
   * The members' ballot on the offer the president moved to accept. Only the
   * most recent one is kept: a vote is always about the current offer, and a
   * rejected one is superseded the moment either side tables a new revision.
   */
  ratification?: BargainingRatification;
  settledAgreementId?: ObjectId;
  endedAtTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type CollectiveAgreementStatus = "active" | "expired" | "superseded";

/**
 * The enforceable result of a settled bargaining campaign. The agreement sets
 * a wage floor for its snapshotted locals and protects them from union-called
 * strikes until noStrikeUntilTurn. A turn pass expires the row but never
 * deletes it, preserving industrial-relations history.
 */
export interface CollectiveAgreement {
  _id: ObjectId;
  campaignId: ObjectId;
  unionId: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType;
  employerCorporationId: ObjectId;
  sectorIds: ObjectId[];
  wageLevel: number;
  /** A8: the pension contribution the parties settled on. Absent reads as zero. */
  pensionContributionRate?: number;
  startsAtTurn: number;
  expiresAtTurn: number;
  noStrikeUntilTurn: number;
  status: CollectiveAgreementStatus;
  createdAt: Date;
  updatedAt: Date;
}
