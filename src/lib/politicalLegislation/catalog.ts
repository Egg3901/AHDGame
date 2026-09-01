/**
 * Catalog registry — the read surface every consumer (projection, seeding,
 * cost UI, deleters) uses. Content lives in laws/*Laws.ts (transcribed).
 */

import { DD_LAWS } from "./laws/ddLaws";
import { DD_LAND_LAWS } from "./laws/ddLandLaws";
import { RU_LAWS } from "./laws/ruLaws";
import { UK_LAWS } from "./laws/ukLaws";
import { US_LAWS } from "./laws/usLaws";
import { US_STATE_TAX_LAWS } from "./laws/usStateTaxLaws";
import type { LawCountryId, PoliticalLaw } from "./types";

/** Locked core catalogs (topology / RU↔DD cost parity). */
const CORE_CATALOGS: Record<LawCountryId, PoliticalLaw[]> = {
  US: US_LAWS,
  UK: UK_LAWS,
  RU: RU_LAWS,
  DD: DD_LAWS,
  DE: [],
};

/** Regional-only sidecars (not part of the 109-law core). */
const REGIONAL_SIDECARS: Partial<Record<LawCountryId, PoliticalLaw[]>> = {
  DD: DD_LAND_LAWS,
  US: US_STATE_TAX_LAWS,
};

const CATALOGS: Record<LawCountryId, PoliticalLaw[]> = {
  US: [...CORE_CATALOGS.US, ...US_STATE_TAX_LAWS],
  UK: CORE_CATALOGS.UK,
  RU: CORE_CATALOGS.RU,
  DD: [...CORE_CATALOGS.DD, ...DD_LAND_LAWS],
  DE: [],
};

const LAWS_BY_ID = new Map<string, PoliticalLaw>(
  Object.values(CATALOGS)
    .flat()
    .map((law) => [law.id, law])
);

/** Whether the law exists as a proposable/enactable type in the given year. */
export function isLawActive(law: PoliticalLaw, year: number): boolean {
  if (!law.window) return true;
  if (year < law.window.from) return false;
  if (law.window.to != null && year > law.window.to) return false;
  return true;
}

/**
 * Day-one enacted level at a year. Anchors win when declared; otherwise the
 * scalar baselineLevel; otherwise 0 (fully repealed). Interpolated linearly
 * then rounded to a whole level, clamped at both ends.
 */
export function baselineLevelFor(law: PoliticalLaw, year: number): 0 | 1 | 2 | 3 | 4 {
  const anchors = law.baselineLevelAnchors;
  if (!anchors || anchors.length === 0) return law.baselineLevel ?? 0;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (year <= first.year) return first.level;
  if (year >= last.year) return last.level;
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1];
    const b = anchors[i];
    if (year <= b.year) {
      const t = (year - a.year) / (b.year - a.year);
      return Math.round(a.level + (b.level - a.level) * t) as 0 | 1 | 2 | 3 | 4;
    }
  }
  return last.level;
}

/**
 * Omitting `year` returns the unfiltered catalog; passing a year filters to the
 * laws that exist then.
 *
 * The SEED path passes a year. The RUNTIME consumers (dynamics.ts,
 * enactedLevels.ts, politicalMetricsDynamics.ts, countryPoliticalMetrics.ts)
 * deliberately do NOT yet — filtering them is coupled to the law-retirement
 * design (what happens to an ENACTED law, and its budget lines, when a world
 * crosses the law's `to` year), which follows the existing runEraCrossing /
 * runMetricActivation precedent rather than being invented here. This is inert
 * today because no law declares a window; it must be settled before any law
 * does. Not an oversight — see the retirement section of the design spec.
 */
/**
 * Accepts any country id, not just a LawCountryId: since the step-6 cutover the
 * 22 non-playables read the political board too, and the dynamics phase runs
 * for them. They have no new-generation catalog yet, so they get an EMPTY one —
 * which composes to a zero law-target, the self-heal adopts their seeded values
 * as equilibrium, and Bridge B's macro term is what actually moves their board.
 * Returning undefined here would crash that phase on the first non-playable.
 */
export function getCatalog(countryId: string, year?: number): PoliticalLaw[] {
  const all = CATALOGS[countryId as LawCountryId] ?? [];
  return year == null ? all : all.filter((law) => isLawActive(law, year));
}

/** Core catalog only — excludes regional sidecars (DD Land laws, etc.). */
export function getCoreCatalog(countryId: string, year?: number): PoliticalLaw[] {
  const all = CORE_CATALOGS[countryId as LawCountryId] ?? [];
  return year == null ? all : all.filter((law) => isLawActive(law, year));
}

/** Regional-only sidecar laws for a country (empty when none authored). */
export function getRegionalCatalog(countryId: string, year?: number): PoliticalLaw[] {
  const all = REGIONAL_SIDECARS[countryId as LawCountryId] ?? [];
  return year == null ? all : all.filter((law) => isLawActive(law, year));
}

export function getLaw(lawId: string): PoliticalLaw | null {
  return LAWS_BY_ID.get(lawId) ?? null;
}

/** All new-generation law ids including regional sidecars (used by seed deleters). */
export function getAllNewGenerationLawIds(): string[] {
  return [...LAWS_BY_ID.keys()];
}

/** True iff the id belongs to the new political-legislation catalogs. */
export function isNewGenerationLawId(id: string): boolean {
  return LAWS_BY_ID.has(id);
}
