/**
 * Playable-scoped legislation must never carry metricEffects targeting a legacy
 * path with no store behind it. Such effects are inert, and they are the main
 * reason the old and new metric systems get confused — someone reads a law,
 * sees a stated effect, and assumes it happens.
 *
 * The predicate below used to live in
 * `politicalLegislation/demolishedPaths.ts`. Every runtime writer that needed it
 * has since been routed to the political board or removed, which left it as
 * production code with only test consumers, so it was deleted and inlined here —
 * the one place that still asks the question.
 */
import { describe, expect, it } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";

const SCOPE_TO_COUNTRY: Record<string, string> = { us: "US", uk: "UK", ru: "RU", dd: "DD" };

/**
 * Categories that survived the retirement wholesale: `economic.*` is the macro
 * layer and `population.*` is the demographics engine's working state. Both are
 * still stored, so a law effect targeting them lands.
 */
const SURVIVOR_CATEGORIES = new Set(["economic", "population"]);

/**
 * Individual survivors. `governance.independenceDesire` is mechanic state that
 * rides the macro doc, and its drift phase is its sole owner.
 *
 * The fiscal pair (`budgetBalance` / `debtToGdp`) also rides the macro doc but
 * is deliberately NOT listed: it is written by the budget sync, not by a law
 * effect, so an audit asking "can a law reach this" must keep saying no.
 */
const SURVIVOR_PATHS = new Set(["governance.independenceDesire"]);

/**
 * True when `metricPath` ("category.metricId", with or without a trailing
 * ".value") has no store behind it for that country — so a law effect naming it
 * does nothing.
 *
 * Gated on the board predicate: a country whose political metrics live on the
 * board has no legacy doc for a law to write into, while a country with no
 * board (SCO/WAL, latent until the independence process activates them) is not
 * in that position.
 */
function isOrphanedEffectPath(countryId: string | null | undefined, metricPath: string): boolean {
  if (!isPoliticalApprovalCountry(countryId)) return false;
  const [category, metricId] = metricPath.split(".");
  if (!category || !metricId) return false;
  if (SURVIVOR_CATEGORIES.has(category)) return false;
  return !SURVIVOR_PATHS.has(`${category}.${metricId}`);
}

describe("isOrphanedEffectPath", () => {
  it("flags political paths on every board country", () => {
    for (const id of ["US", "UK", "RU", "DD"]) {
      expect(isOrphanedEffectPath(id, "publicSafety.crimeRate"), id).toBe(true);
    }
    // A trailing ".value" is tolerated — stored effects carry both spellings.
    expect(isOrphanedEffectPath("UK", "healthcare.nhsWaitingTime.value")).toBe(true);
  });

  it("is false for a country with no board, and for junk input", () => {
    expect(isOrphanedEffectPath("ZZ", "publicSafety.crimeRate")).toBe(false);
    expect(isOrphanedEffectPath(null, "publicSafety.crimeRate")).toBe(false);
  });

  it("spares the survivors", () => {
    expect(isOrphanedEffectPath("US", "economic.gdpGrowth")).toBe(false);
    expect(isOrphanedEffectPath("US", "economic.costOfLiving.value")).toBe(false);
    expect(isOrphanedEffectPath("US", "population.birthRate")).toBe(false);
    expect(isOrphanedEffectPath("UK", "governance.independenceDesire")).toBe(false);
    expect(isOrphanedEffectPath("UK", "governance.independenceDesire.value")).toBe(false);
  });

  it("still flags the fiscal pair — the budget sync writes it, not a law", () => {
    expect(isOrphanedEffectPath("US", "governance.budgetBalance")).toBe(true);
    expect(isOrphanedEffectPath("US", "governance.debtToGdp")).toBe(true);
  });
});

describe("orphaned metricEffects on playable legislation", () => {
  it("has none", () => {
    const offenders: string[] = [];
    for (const t of legislationTypes) {
      const countryId = SCOPE_TO_COUNTRY[t.countryScope ?? "us"];
      if (!countryId) continue;
      for (const option of t.policyOptions ?? []) {
        for (const effect of option.metricEffects ?? []) {
          const path = `${effect.category}.${effect.metricId}`;
          if (isOrphanedEffectPath(countryId, path)) {
            offenders.push(`${t._id} :: ${option.id} -> ${path}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
