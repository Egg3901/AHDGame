/**
 * Regional default law for new-generation `both` laws.
 *
 * A `both` law may be enacted nationally OR supplemented by a region. The
 * national side seeds a `statePolicies` row per law; the regional side seeded
 * nothing, because `seedPoliticalLegislationBaseline` only walked
 * `getRegionalCatalog()` (the DD Land sidecars). Meanwhile
 * `projectLawToLegislationType` passes `allowedScope: "both"` straight through
 * and `/api/game/legislation-types?scope=state` offers exactly that, so every
 * `both` law was proposable in a region that had no current law for it.
 *
 * That blanks more than the "Current law" box. `LawProvisionComparison` bails
 * on `currentIndex === undefined`, taking the fiscal comparison AND the
 * political-metric chips with it, which is what a player sees as "this regional
 * infrastructure bill has no metrics".
 *
 * THE LEVEL IS 0, AND NOT A JUDGEMENT CALL. `getEnactedLevel` already states
 * the engine's rule — "region reads without a record stay at 0 until seeded or
 * enacted through play" — and `seedPoliticalMetricsResiduals` composes day-one
 * equilibrium from the national law book plus `REGIONAL_SUPPLEMENT_FACTOR` ×
 * the *sidecar* baselines only. Seeding these rows at 0 therefore changes
 * nothing the dynamics engine reads; seeding them at `baselineLevelFor` would
 * double-count every `both` law into every region's target, which is a balance
 * change needing its own issue and a simulation report.
 */

import { getCatalog, getLaw } from "./catalog";
import type { PoliticalLaw } from "./types";

/** A region starts with no program of its own on top of the national law. */
export const REGIONAL_DEFAULT_LEVEL = 0;

/**
 * The non-tax `both` laws of a country — the ones a region may legislate on
 * top of the national law, and so the ones needing a regional default row.
 *
 * Regional sidecars (`allowedScope: "regional"`) are deliberately absent: they
 * seed their own authored `baselineLevelFor` baseline through the existing
 * path, and must never be flattened to 0 by this one. Tax laws are absent
 * because their state lives in `federalBudget.taxRates`, not `statePolicies`.
 *
 * Omitting `year` returns the unfiltered set; passing one applies the same era
 * window `getCatalog` applies everywhere else.
 */
export function regionalDefaultLaws(countryId: string, year?: number): PoliticalLaw[] {
  return getCatalog(countryId, year).filter(
    (law) => law.kind !== "tax" && law.allowedScope === "both"
  );
}

/**
 * The level a law sits at in a region with no `statePolicies` row, or
 * `undefined` when the id is not a law this rule covers.
 *
 * The read-path half of the fix, so a region added after the seed ran — or a
 * world seeded before the backfill migration — still renders a current law
 * instead of a blank provision. Callers apply it only at region scope; at
 * national scope a missing row means something else is wrong and should not be
 * papered over.
 *
 * Deliberately NOT narrowed by country. Law ids are globally unique across the
 * four catalogs — `getProjectedPoliticalLegislationTypes`' test asserts the
 * projected `_id` set is as large as the catalog itself — so the id alone
 * already identifies the country. A country parameter could only ever REJECT a
 * correct answer: `resolveBillCountryId` falls back to "US" for a legacy bill it
 * cannot place, which would silently drop a RU/UK/DD region back to the ladder
 * centre. It buys no protection and adds a failure mode.
 */
export function regionalDefaultLevel(lawId: string): number | undefined {
  const law = getLaw(lawId);
  if (!law || law.kind === "tax") return undefined;
  return law.allowedScope === "both" ? REGIONAL_DEFAULT_LEVEL : undefined;
}
