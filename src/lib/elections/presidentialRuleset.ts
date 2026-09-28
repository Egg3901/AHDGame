import type { Election } from "@/lib/db/types";
import { SUSPEND_ENDORSE_TRANSFER_MAX_FRACTION } from "@/lib/campaigns/constants/suspendEndorse";

/**
 * Presidential ruleset version seam (the retrospective's "rules freeze" gate).
 *
 * A presidential race is stamped with its rules family when it spawns. Older
 * v1/v2 races retain their historical behavior; the active v3 family receives
 * the current calibrated v3 rules prospectively without rewriting ballots
 * already cast.
 *
 * Unstamped races resolve to v1, the behavior they opened under. New mechanics
 * normally ship by adding a version. The active race is already v3, however,
 * and the v3 balance corrections below intentionally apply only to ballots
 * cast after deployment. They never rewrite its accumulated tally.
 */
export const CURRENT_PRESIDENTIAL_RULESET_VERSION = 3;

export interface PresidentialRuleset {
  version: number;
  /**
   * Asymptotic cap on the campaign-strength vote-multiplier bonus
   * (1 = the multiplier approaches 2x; 0.25 would cap it near 1.25x).
   */
  campaignStrengthMaxBonus: number;
  /** Apply the legacy post-distribution state/district lean multiplier. */
  applyExplicitLeanMultiplier: boolean;
  /** Closing-period share of locally nonviable candidates' new ballots that move tactically. */
  tacticalMovementRate: number;
  /** Weight on state approval in the presidential incumbency signal (0 = national only). */
  incumbentApprovalStateWeight: number;

  // ── Primary calendar + momentum ───────────────────────────────────────────
  /**
   * Which primary wave-spacing table the race runs. "compressed" bunches all
   * six waves into the last six turns (the audited defect); "stretched" spaces
   * them across the primary window so results land with a reaction gap. Purely
   * structural (timing, not magnitude); "stretched" only ever applies to races
   * spawned under the version that sets it.
   */
  primaryCalendar: "compressed" | "stretched";
  /**
   * Cap (in national share points) on the expectation-beating momentum boost a
   * candidate earns from a wave. 0 = momentum is computed and persisted but
   * applies a x1 (identity) multiplier -- the ship value until calibrated.
   */
  primaryMomentumCapPoints: number;
  /** Fraction of accumulated momentum that carries to the next wave (halves at 0.5). */
  primaryMomentumDecay: number;

  // ── Nomination: convention + endorsements + suspension transfers ───────────
  /**
   * When true, a nomination with no delegate majority resolves through an
   * explicit multi-ballot convention instead of a silent plurality/score
   * fallback. Structural; only affects races spawned under the setting version.
   */
  conventionEnabled: boolean;
  /**
   * How a suspended campaign's support transfers to its endorsee. "flat"
   * transfers `suspendTransferMaxFraction` regardless of alignment (today's
   * behavior); "affinity" scales it by ideological/coalition closeness.
   */
  suspendTransferMode: "flat" | "affinity";
  /** Ceiling on the suspended-campaign transfer fraction. */
  suspendTransferMaxFraction: number;
  /**
   * Fraction of an endorser's organization weight added to the endorsed
   * candidate per active endorsement. 0 = endorsements grant no org (identity).
   */
  endorsementOrgFraction: number;
  /**
   * Per-endorsement coalition-credibility vote multiplier increment.
   * 0 = endorsements grant no credibility bump (identity).
   */
  endorsementCoalitionCredibility: number;

  // ── Running-mate surrogate ────────────────────────────────────────────────
  /** Daily cap on VP ticket-surrogate actions (canvass-for-ticket + state visit combined). */
  vpSurrogateActionCap: number;
  /**
   * Weight (0..1) on the VP's own travel-presence favorability bump relative to
   * the nominee's 1.0x. 1.0 = no discount (identity for a brand-new mechanic).
   */
  vpTravelPresenceWeight: number;
}

/**
 * Identity baseline for legacy v1/v2 races. V3 starts here and overrides the
 * mechanics that belong to the presidential rework.
 */
const IDENTITY: Omit<PresidentialRuleset, "version"> = {
  campaignStrengthMaxBonus: 1,
  applyExplicitLeanMultiplier: true,
  tacticalMovementRate: 0,
  incumbentApprovalStateWeight: 0,
  primaryCalendar: "compressed",
  primaryMomentumCapPoints: 0,
  primaryMomentumDecay: 0.5,
  conventionEnabled: false,
  suspendTransferMode: "flat",
  suspendTransferMaxFraction: SUSPEND_ENDORSE_TRANSFER_MAX_FRACTION,
  endorsementOrgFraction: 0,
  endorsementCoalitionCredibility: 0,
  vpSurrogateActionCap: 2,
  vpTravelPresenceWeight: 1,
};

const V1: PresidentialRuleset = { version: 1, ...IDENTITY };

/** v2 is identical to v1 (the original seam shipped as pure infrastructure). */
const V2: PresidentialRuleset = { version: 2, ...IDENTITY };

/**
 * v3 is the presidential-rework version. It is updated field-by-field by the
 * rework subsystem PRs (each flip paired with the code that reads it).
 *
 * primaryCalendar → "stretched": the primary-calendar subsystem's structural
 * flip. Spacing only (timing, not magnitude), so it applies only to races
 * spawned under v3. The
 * momentum magnitude knobs (primaryMomentumCapPoints/Decay) stay at identity:
 * momentum computes and persists but multiplies x1 until calibrated at t384.
 *
 * conventionEnabled → true and suspendTransferMode → "affinity": the nomination
 * subsystem's two STRUCTURAL flips. Both change WHICH path a race takes, not the
 * magnitudes, so they are safe mid-cycle and only reach 1964+ spawns. The
 * magnitude knobs stay at identity: suspendTransferMaxFraction keeps 0.25 (a
 * perfectly aligned suspender still transfers today's 25%, misaligned ones less),
 * and endorsementOrgFraction / endorsementCoalitionCredibility stay 0 so
 * endorsements grant no org or credibility until calibrated at t384.
 */
const V3: PresidentialRuleset = {
  version: 3,
  ...IDENTITY,
  campaignStrengthMaxBonus: 0.25,
  applyExplicitLeanMultiplier: false,
  tacticalMovementRate: 0.05,
  incumbentApprovalStateWeight: 0.5,
  primaryCalendar: "stretched",
  conventionEnabled: true,
  suspendTransferMode: "affinity",
};

const RULESETS: Record<number, PresidentialRuleset> = {
  1: V1,
  2: V2,
  3: V3,
};

/**
 * Resolve the ruleset a presidential election runs under. Unstamped races are
 * v1 (they opened before the seam existed); an unknown future stamp falls
 * back to the newest known ruleset rather than crashing a live race on a
 * rolled-back deploy.
 */
export function presidentialRulesetFor(
  election: Pick<Election, "rulesetVersion"> | null | undefined
): PresidentialRuleset {
  const version = election?.rulesetVersion;
  if (version == null) return RULESETS[1];
  return RULESETS[version] ?? RULESETS[CURRENT_PRESIDENTIAL_RULESET_VERSION];
}
