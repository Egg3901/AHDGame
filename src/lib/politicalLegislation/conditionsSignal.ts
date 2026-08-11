/**
 * SP4 — NPP conditions signal from political category scores (spec §3).
 *
 * For LAW_COUNTRY_IDS the legacy per-metric stateMetrics scan is replaced by
 * the nine SP1 category scores: a category under WEAK_DOMAIN_THRESHOLD
 * contributes weakness proportional to its shortfall, keyed by the LOWERCASED
 * pipeline policyDomain vocabulary — `urgencyForType` lowercases the
 * legislation type's domain before the weakDomains lookup
 * (selectNppBill.ts), so camelCase "publicSafety" must be emitted as
 * "publicsafety" or Public Order weakness never drives an NPP bill.
 */

import type { Db } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { State } from "@/lib/db/types/state";
import type { CountryId } from "@/lib/constants/countries";
import { aggregateNationalPoliticalMetrics, categoryScore } from "@/lib/politicalMetrics/aggregate";
import { POLITICAL_METRIC_CATEGORIES, type PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { PIPELINE_POLICY_DOMAIN } from "./project";

/** Category score below this (Weak/Critical territory; 40–54 is merely Strained) = weak domain. */
export const WEAK_DOMAIN_THRESHOLD = 40;
/**
 * Category score at/above this = comfortably strong - the mirror of
 * `WEAK_DOMAIN_THRESHOLD`, feeding the governing agenda's "lower" direction
 * the same way `WEAK_DOMAIN_THRESHOLD` feeds "raise" (see
 * `computeGoverningAgenda`). The 40-75 band takes no position either way.
 */
export const STRONG_DOMAIN_THRESHOLD = 75;

/**
 * weakDomains for the NPP urgency model, keyed by lowercased §5.2 vocabulary.
 * Max-merge if two categories ever map to one domain.
 */
export function politicalWeakDomains(
  national: Record<PoliticalMetricId, number>
): Record<string, number> {
  const weak: Record<string, number> = {};
  for (const cat of POLITICAL_METRIC_CATEGORIES) {
    const score = categoryScore(national, cat.id);
    if (score >= WEAK_DOMAIN_THRESHOLD) continue;
    const domain = PIPELINE_POLICY_DOMAIN[cat.id].toLowerCase();
    const urgency = Math.max(0, (WEAK_DOMAIN_THRESHOLD - score) / WEAK_DOMAIN_THRESHOLD);
    if (urgency > (weak[domain] ?? 0)) weak[domain] = urgency;
  }
  return weak;
}

/**
 * strongDomains for the governing agenda's "lower" direction - the mirror of
 * `politicalWeakDomains`. A comfortably-strong category (e.g. a well-funded
 * defense or health board) invites the government to ease off rather than
 * keep raising it forever. Max-merge if two categories ever map to one domain.
 */
export function politicalStrongDomains(
  national: Record<PoliticalMetricId, number>
): Record<string, number> {
  const strong: Record<string, number> = {};
  for (const cat of POLITICAL_METRIC_CATEGORIES) {
    const score = categoryScore(national, cat.id);
    if (score < STRONG_DOMAIN_THRESHOLD) continue;
    const domain = PIPELINE_POLICY_DOMAIN[cat.id].toLowerCase();
    const comfort = Math.min(
      1,
      (score - STRONG_DOMAIN_THRESHOLD) / (100 - STRONG_DOMAIN_THRESHOLD)
    );
    if (comfort > (strong[domain] ?? 0)) strong[domain] = comfort;
  }
  return strong;
}

/**
 * Load a playable country's population-weighted national political board.
 * Null when unseeded. Shared by the NPP conditions signal and the crisis
 * trigger's adapted metric reads.
 */
export async function loadNationalPoliticalBoard(
  db: Db,
  countryId: CountryId
): Promise<Record<PoliticalMetricId, number> | null> {
  const [docs, states] = await Promise.all([
    db.collection<PoliticalMetricsDoc>("politicalMetrics").find({ countryId }).toArray(),
    db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1, population: 1 } })
      .toArray(),
  ]);
  if (docs.length === 0) return null;
  const populationByRegion = new Map(states.map((s) => [s._id, s.population ?? 0]));
  return aggregateNationalPoliticalMetrics(docs, populationByRegion);
}

/**
 * Load a playable country's weak AND strong domains off a single national
 * political board fetch. Null when unseeded. The governing agenda's "raise"
 * driver reads `weak`, its "lower" driver reads `strong` (see
 * `computeGoverningAgenda`) - one board read backs both.
 */
export async function loadPoliticalConditionsDomains(
  db: Db,
  countryId: PoliticalMetricsCountryId
): Promise<{ weak: Record<string, number>; strong: Record<string, number> } | null> {
  const national = await loadNationalPoliticalBoard(db, countryId);
  if (!national) return null;
  return { weak: politicalWeakDomains(national), strong: politicalStrongDomains(national) };
}

/**
 * SP4 branch-audit fix — the governing brain's domain-health map for
 * playables, in the METRIC_TO_DOMAIN vocabulary consumed by
 * governingMetrics.loadDomainHealth (agenda goal-met checks). Only the
 * POLITICAL domains are emitted here; the economic domains (employment,
 * economic_growth, income_inequality, poverty) stay on the surviving legacy
 * economic metrics the caller already reads.
 */
export function politicalDomainHealth(
  national: Record<PoliticalMetricId, number>
): Record<string, number> {
  return {
    education: categoryScore(national, "education"),
    workforce: national["education.adultSkills"] ?? 0,
    healthcare: categoryScore(national, "health"),
    infrastructure: categoryScore(national, "infrastructure"),
    public_safety: categoryScore(national, "order"),
    environment: categoryScore(national, "environment"),
    social_mobility: national["society.socialMobility"] ?? 0,
    governance: categoryScore(national, "governance"),
  };
}
