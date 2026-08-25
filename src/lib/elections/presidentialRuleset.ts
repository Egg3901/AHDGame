import type { Election } from "@/lib/db/types";

/**
 * Presidential ruleset version seam (the retrospective's "rules freeze" gate).
 *
 * A presidential race is stamped with the CURRENT version when it spawns and
 * keeps that ruleset for its whole cycle: deploys during a live race can no
 * longer change how it counts. The 1956 ballot record is why this exists --
 * the electorate model changed mid-race and the totals moved with the code.
 *
 * Races that predate the stamp (the 1953/1956 records and the open 1960 race)
 * resolve to v1, the live behavior they opened under. Mechanics and balance
 * changes ship by ADDING a version whose values differ, so they take effect
 * on the next spawned cycle and never mid-race -- "grandfather the active
 * race; convert, do not confiscate".
 *
 * v3 is the presidential-rework version. It ships BEHAVIORALLY IDENTICAL to
 * v1/v2 (every field below at its current/identity value): the seam and the
 * full knob set land as pure infrastructure with zero behavior change. Each
 * rework subsystem then flips ONLY its own v3 knob to the active value in the
 * same PR that adds the code consuming it, so v3 is always coherent with the
 * merged engine. Magnitude knobs (momentum cap, endorsement/transfer
 * fractions, surrogate weights) stay at identity until calibrated against the
 * 1960 general via the dry-run replays at turn 384; structural knobs
 * (calendar spacing, convention) flip with their code and only affect the
 * 1964 cycle onward.
 */
export const CURRENT_PRESIDENTIAL_RULESET_VERSION = 3;

export interface PresidentialRuleset {
  version: number;
  /**
   * Asymptotic cap on the campaign-strength vote-multiplier bonus
   * (1 = the multiplier approaches 2x; 0.25 would cap it near 1.25x).
   */
  campaignStrengthMaxBonus: number;

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
 * Identity baseline: the exact live behavior of the 1953/1956/1960 era. Every
 * knob here reproduces current production. V1, V2, and V3 all start from this;
 * subsystem PRs override individual v3 fields as their code lands.
 */
const IDENTITY: Omit<PresidentialRuleset, "version"> = {
  campaignStrengthMaxBonus: 1,
  primaryCalendar: "compressed",
  primaryMomentumCapPoints: 0,
  primaryMomentumDecay: 0.5,
  conventionEnabled: false,
  suspendTransferMode: "flat",
  suspendTransferMaxFraction: 0.25,
  endorsementOrgFraction: 0,
  endorsementCoalitionCredibility: 0,
  vpSurrogateActionCap: 2,
  vpTravelPresenceWeight: 1,
};

const V1: PresidentialRuleset = { version: 1, ...IDENTITY };

/** v2 is identical to v1 (the original seam shipped as pure infrastructure). */
const V2: PresidentialRuleset = { version: 2, ...IDENTITY };

/**
 * v3 is the presidential-rework version. It is mutated field-by-field by the
 * rework subsystem PRs (each flip paired with the code that reads it).
 *
 * primaryCalendar → "stretched": the primary-calendar subsystem's structural
 * flip. Spacing only (timing, not magnitude), so it is safe to land during the
 * live 1960 race — that race is v1 (unstamped) and keeps the compressed table;
 * "stretched" applies only to races spawned under v3 (1964 onward). The
 * momentum magnitude knobs (primaryMomentumCapPoints/Decay) stay at identity:
 * momentum computes and persists but multiplies x1 until calibrated at t384.
 */
const V3: PresidentialRuleset = { version: 3, ...IDENTITY, primaryCalendar: "stretched" };

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
