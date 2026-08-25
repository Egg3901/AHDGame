import type { Election } from "@/lib/db/types";

/**
 * Presidential ruleset version seam (the retrospective's "rules freeze" gate).
 *
 * A presidential race is stamped with the CURRENT version when it spawns and
 * keeps that ruleset for its whole cycle: deploys during a live race can no
 * longer change how it counts. The 1956 ballot record is why this exists —
 * the electorate model changed mid-race and the totals moved with the code.
 *
 * Races that predate the stamp (the 1953/1956 records and the open 1960 race)
 * resolve to v1, the live behavior they opened under. Balance-lane changes
 * (campaign-strength conversion, geographic favorability, primary momentum)
 * ship by ADDING a version whose values differ, so they take effect on the
 * next spawned cycle and never mid-race — "grandfather the active race;
 * convert, do not confiscate".
 */
export const CURRENT_PRESIDENTIAL_RULESET_VERSION = 2;

export interface PresidentialRuleset {
  version: number;
  /**
   * Asymptotic cap on the campaign-strength vote-multiplier bonus
   * (1 = the multiplier approaches 2x; 0.25 would cap it near 1.25x).
   */
  campaignStrengthMaxBonus: number;
}

const V1: PresidentialRuleset = {
  version: 1,
  campaignStrengthMaxBonus: 1,
};

/**
 * v2 is currently IDENTICAL to v1 by design: the seam ships as pure
 * infrastructure with zero behavior change. Balance lanes flip individual
 * values here (with replay evidence and owner sign-off), and only elections
 * spawned after that deploy — the 1964 cycle onward — pick them up.
 */
const V2: PresidentialRuleset = {
  ...V1,
  version: 2,
};

const RULESETS: Record<number, PresidentialRuleset> = {
  1: V1,
  2: V2,
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
