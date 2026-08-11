import type { CountryId, GovernmentType, OpsVoteMultipliers } from "@/lib/constants/countries";

/**
 * Per-country runtime state. Mutable fields previously living in
 * COUNTRY_CONFIGS (compile-time constants) are promoted here so they
 * can change mid-game (regime collapse, constitutional convention,
 * future coup / referendum mechanics).
 *
 * Immutable seed data (country name, capital, election system structure,
 * policy categories, mood profile, collapse target) stays in COUNTRY_CONFIGS.
 */
export interface CountryState {
  /** Country code — matches CountryId, used as primary key. */
  _id: CountryId;
  countryId: CountryId;

  /**
   * Government system. Initially seeded from COUNTRY_CONFIGS; mutated on
   * Stage 4 conversion or convention ratification.
   */
  governmentType: GovernmentType;

  /**
   * Sequential ID of the currently ruling party. For one-party states this
   * is enforced; for other systems it tracks the seat-holding government
   * party (informational). Mutated by the admin regime-status flip
   * endpoint and by Stage 3 leadership-change decisions.
   */
  rulingPartyId: number | null;

  /**
   * Vote-weight multipliers applied to ruling-party candidates in
   * one-party-state elections. Tier ladder: 1.5, 1.3, 1.15, 1.0. Mutated
   * by the liberalization reform action "Reduce vote multipliers".
   */
  opsVoteMultipliers: OpsVoteMultipliers | null;

  /**
   * Whether the country participates in the leader confidence model.
   * Effectively "is one-party state" today, but stored separately for
   * future flexibility (e.g. a parliamentary system could opt in).
   */
  hasLeaderConfidenceModel: boolean;

  // ── Phase-5 liberalization-menu fields ──────────────────────────────────

  /** Per-reform-action cooldown turn-of-next-availability. */
  reformCooldowns: ReformCooldownsMap;

  /**
   * Set by Stage 1's "Acknowledge & promise reform" decision. The next
   * reform action taken this turn costs half its intra-party hit; the
   * flag is cleared on first use OR at the turn-tick end (whichever
   * comes first) so it can't bleed across turns.
   */
  pendingReformDiscount?: { turn: number; multiplier: number };

  /**
   * Per-turn additive popular-legitimacy boosts left behind by reform
   * actions. The popular-drift driver sums entries whose `untilTurn`
   * has not yet passed, then evicts the expired ones.
   */
  popularBoostModifiers: PopularBoostModifier[];

  /**
   * Persistent renewal-bump override from the constitutional-amendment
   * reform action. When set, leader renewal grants this number of
   * intra-party confidence points instead of the default +5
   * (`RENEWAL_BUMP`). Set once and never cleared.
   */
  renewalBumpOverride?: number;

  /**
   * One-shot election-fairness flag from the "Hold an honest
   * by-election" reform action. When set, the next election fired in
   * this country uses `atMultiplier` uniformly across every regime
   * status (so a ruling-party candidate gets the same weight as an
   * approved-party challenger). Cleared by the election engine after
   * one election consumes it.
   */
  pendingHonestByElection?: { atMultiplier: number };

  /**
   * Post-conversion snap-election marker written by Phase-6's
   * `bootstrapNewSystem` after a system conversion fires. Holds the
   * turn the snap should kick off, the legacy seat reservation for the
   * former ruling party (0..35 voluntary, 5 forced, 3 if "resist" +
   * stage4Delay flagged), the former-ruling sequentialId, and (for
   * forced paths only) a vote-share penalty applied to the former
   * ruling party. The election engine reads + clears this on the first
   * post-conversion election.
   */
  pendingPostConversionElection?: {
    atTurn: number;
    legacyReservation: number;
    formerRulingPartyId: number | null;
    forcedVoteSharePenalty?: number;
    /** "voluntary" via convention, "forced" via Stage 4. */
    path: "voluntary" | "forced";
  };

  /**
   * Country position on the social (libertarian ↔ authoritarian) axis,
   * −5 (libertarian) … +5 (authoritarian) — the same scale as demographic
   * socialLean and legislation-option `social` scores. Seeded from
   * CountryConfig.socialAxisBaseline; drifts each turn toward the social
   * stance of newly enacted national laws (socialAxisDrift turn phase).
   * Optional: docs created before P6b lack it — readers fall back to the
   * config baseline and the drift phase materializes it on first run.
   */
  socialAxisPosition?: number;

  /**
   * Watermark turn through which national-law social drift has been
   * applied. Prevents double-counting on reprocessed turns and catches
   * out-of-band enactments between turns.
   */
  socialAxisDriftTurn?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface ReformCooldownsMap {
  /** Per-party cooldown for legalize-banned-party (cooldown is partyId-scoped). */
  legalizeParty?: { perPartyId: Record<number, number> };
  /** Turn-of-next-availability for reduce-vote-multipliers. */
  reduceVoteMultipliers?: number;
  /** Turn-of-next-availability for hold-honest-by-election. */
  holdHonestByElection?: number;
  /** Turn-of-next-availability for anticorruption-purge. */
  anticorruptionPurge?: number;
  /** Constitutional amendment is a one-time action — `"used"` blocks reuse. */
  constitutionalAmendment?: "used";
}

export interface PopularBoostModifier {
  /** Reform-action id that produced the boost. */
  source: string;
  /** Additive per-turn delta applied to popular-legitimacy drift. */
  perTurnDelta: number;
  /** Turn (inclusive) up to which the boost still applies. */
  untilTurn: number;
}
