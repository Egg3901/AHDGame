/**
 * Derive a non-playable country's 63-family political board from its authored
 * legacy seeds, in tiers of descending confidence:
 *
 *   tier 1 — invert ADAPTER_TIER1 per family (33 families). The mapping is
 *            already reviewed and used forward for corp margins; a family with
 *            several legacy sources averages them so no single metric reads as
 *            the whole family.
 *   tier 2 — the economy block. Excluded from ADAPTER_TIER1 only because
 *            `economic` is a SURVIVOR category, not because data is missing.
 *   tier 3 — the legacy CATEGORY average via ADAPTER_TIER2_CATEGORY, tilted by
 *            the country's political lean (see countryLean.ts). The category
 *            average sets the level; the lean separates families within it.
 *
 * ON TIER 3 — read before tuning. The legacy block measures OUTCOMES, so on its
 * own it cannot separate families that share a category: `order.dueProcess`
 * (lean -5) and `order.deterrence` (lean +5) both average the same legacy
 * numbers and used to come out identical, collapsing 17 families to 7 distinct
 * values. The missing signal is positional, and it lives in the party seeds —
 * era-gated, authored `economicPosition`/`socialPosition` on the same -5..+5
 * scale — so tier 3 now displaces each family by how well its lean aligns with
 * the country's. Where a party system has no tilt the displacement is zero and
 * the raw category average survives unchanged.
 *
 * Tier 3 is still the coarsest derived tier: the LEVEL comes from a whole
 * legacy category rather than from family-specific metrics. Callers that omit
 * `lean` get the old undifferentiated behaviour, which is correct for any
 * country whose roster does not cover the era being derived.
 *
 *   tier 4 — hand-authored (defenseBoards1953.ts). Legacy stateMetrics has no
 *            defense layer beyond militaryReadiness and defense posture is not
 *            recoverable from outcome metrics, so the 7 defense.* families are
 *            authored per country instead of derived.
 *
 * Anything still unresolved is reported in `unauthored` rather than silently
 * filled — an empty list is the gate that says a country's board is complete.
 *
 * OFFLINE USE ONLY — feeds a codegen script whose output is committed.
 */
import { ADAPTER_TIER1, ADAPTER_TIER2_CATEGORY } from "@/lib/politicalLegislation/marginAdapter";
import { regimeAdjustedParticipation } from "./regimeParticipation";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { FAMILY_SLUGS, POLITICAL_METRIC_CATEGORIES } from "../types";
import { politicalScoreFromLegacyValue } from "./legacyInversion";
// Shared with Bridge B — see macroFamilySources for why it lives outside derive/.
import { TIER2_SOURCES } from "../macroFamilySources";
import { defenseBoardFor } from "./defenseBoards1953";
import { leanAdjustedTier3, type CountryLean } from "./countryLean";

export interface DerivedFamily {
  value: number;
  /** 4 = hand-authored (defense), which no legacy data can produce. */
  tier: 1 | 2 | 3 | 4;
  /** Legacy paths (or macro paths) the value came from — for review. */
  sources: string[];
}

export interface DerivedBoard {
  values: Record<string, DerivedFamily>;
  /** Families with no derivable source; must be authored by hand. */
  unauthored: string[];
}

export interface DeriveInput {
  countryId: string;
  /** Flat "category.metricId" → value from the country's stateMetrics seed. */
  legacy: Record<string, number>;
  /** Flat "category.metricId" → value from macroMetrics (economic/population). */
  macro: Record<string, number>;
  /**
   * The country's political centre of gravity for the era being derived, used
   * to tilt tier 3. Omit to keep the raw category average — correct when the
   * party roster does not cover the era.
   */
  lean?: CountryLean | null;
  /**
   * In-game year of the era being derived. Scores each legacy value against its
   * band FOR THAT YEAR rather than the modern thresholds, so a 1953 country is
   * judged by 1953 standards. Omitting it reproduces the modern-threshold
   * behaviour exactly.
   */
  year?: number | null;
}

function allFamilies(): string[] {
  const out: string[] = [];
  for (const cat of POLITICAL_METRIC_CATEGORIES) {
    for (const slug of FAMILY_SLUGS[cat.id]) out.push(`${cat.id}.${slug}`);
  }
  return out;
}

/** Legacy paths that feed each family, inverted from ADAPTER_TIER1 once. */
const TIER1_SOURCES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [legacyPath, familyId] of Object.entries(ADAPTER_TIER1)) {
    (out[familyId] ??= []).push(legacyPath);
  }
  return out;
})();

/** Political category → the legacy categories that map to it (tier 3). */
const TIER3_LEGACY_CATEGORIES: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [legacyCat, politicalCat] of Object.entries(ADAPTER_TIER2_CATEGORY)) {
    (out[politicalCat] ??= []).push(legacyCat);
  }
  return out;
})();

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function scoresFrom(
  paths: string[],
  values: Record<string, number>,
  countryId: string,
  year?: number | null
): { scores: number[]; used: string[] } {
  const scores: number[] = [];
  const used: string[] = [];
  for (const path of paths) {
    const raw = values[path];
    if (raw == null || !Number.isFinite(raw)) continue;
    const [category, metricId] = path.split(".");
    // ERA WINDOW. A metric the catalog says does not exist yet cannot describe
    // the era being derived, whatever number the seed happens to hold. Skipping
    // it lets the family fall through to a tier that CAN — which is the whole
    // point of the tier ladder.
    //
    // This was not academic. `economy.productivity`'s only tier-1 source is
    // `governance.roboticsAdoption` (window opens 1980) and
    // `environment.energySecurity`'s is `environment.nuclearSafety` (1957). On
    // the 1953 board tier 1 fired on both, and the result depended on nothing
    // but how each country's era overlay happened to treat a metric that should
    // not have been consulted at all: countries whose overlay zeroed it scored
    // 0 (JP/DE/SE/TR — 99 of 147 regions floored on productivity), while
    // countries whose overlay omitted it kept the modern seed and scored 72
    // (Italy, with robots and nuclear plants in 1953). Inconsistent between
    // countries, which is worse than uniformly wrong.
    if (!isMetricActive(metricId, countryId, year ?? null)) continue;
    const score = politicalScoreFromLegacyValue(category, metricId, raw, countryId, year);
    if (score == null) continue;
    scores.push(score);
    used.push(path);
  }
  return { scores, used };
}

export function deriveCountryBoard(input: DeriveInput): DerivedBoard {
  const { countryId, legacy, macro, lean, year } = input;
  // Tier 2 spans both stores (see TIER2_SOURCES); macro wins on key collision
  // because economic/population are its owned categories post-SP5.
  const combined = { ...legacy, ...macro };
  const values: Record<string, DerivedFamily> = {};
  const unauthored: string[] = [];

  for (const familyId of allFamilies()) {
    // tier 1
    const t1 = scoresFrom(TIER1_SOURCES[familyId] ?? [], legacy, countryId, year);
    if (t1.scores.length) {
      const raw = mean(t1.scores);
      // Participation is inverted from voter TURNOUT, which cannot tell a
      // mobilised electorate from a compelled one — see regimeParticipation.ts.
      // Identity for every competitive-election country.
      const value =
        familyId === "governance.participation" ? regimeAdjustedParticipation(raw, countryId) : raw;
      values[familyId] = {
        value,
        tier: 1,
        sources: value === raw ? t1.used : [...t1.used, "singleSlateElections"],
      };
      continue;
    }
    // tier 2
    const t2 = scoresFrom(TIER2_SOURCES[familyId] ?? [], combined, countryId, year);
    if (t2.scores.length) {
      values[familyId] = { value: mean(t2.scores), tier: 2, sources: t2.used };
      continue;
    }
    // tier 3 — average every legacy metric in the mapped legacy categories,
    // then tilt by how the family's lean aligns with the country's.
    const politicalCat = familyId.split(".")[0];
    const legacyCats = TIER3_LEGACY_CATEGORIES[politicalCat] ?? [];
    const catPaths = Object.keys(legacy).filter((p) => legacyCats.includes(p.split(".")[0]));
    const t3 = scoresFrom(catPaths, legacy, countryId, year);
    if (t3.scores.length) {
      const base = mean(t3.scores);
      const tilted = leanAdjustedTier3(base, familyId, lean);
      values[familyId] = {
        value: tilted,
        tier: 3,
        // Record the lean only when it actually moved the value, so review can
        // tell a tilted family from one whose country had no signal.
        sources: tilted === base ? t3.used : [...t3.used, "countryLean"],
      };
      continue;
    }
    // tier 4 — hand-authored. Today this is exactly the defense block: legacy
    // stateMetrics has no defense layer to invert, so it is authored per country
    // in defenseBoards1953.ts rather than derived.
    const authored = defenseBoardFor(countryId, year)?.[familyId];
    if (typeof authored === "number" && Number.isFinite(authored)) {
      values[familyId] = { value: authored, tier: 4, sources: ["authored"] };
      continue;
    }
    unauthored.push(familyId);
  }

  return { values, unauthored };
}
