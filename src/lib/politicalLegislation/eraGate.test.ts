/**
 * §10 era-gate assert: new-generation law ids must NEVER appear in the era
 * catalogs. Their activity comes from the unknown-id default in
 * isLegislationTypeActive, and their pricing from costModelV2 routing — an id
 * registered in LEGISLATION_ERA could be flipped inactive by a future
 * era-tagging sweep (silently zeroing every new-generation budget line), and
 * one in LEGISLATION_COST_CLASS would route into the legacy cost classes.
 */

import { describe, expect, it } from "vitest";
import { LEGISLATION_ERA } from "@/lib/era/legislationCatalog";
import { LEGISLATION_COST_CLASS } from "@/lib/era/legislationCostCatalog";
import { getAllNewGenerationLawIds } from "./catalog";

describe("era-gate assert (spec §10)", () => {
  const newGenerationIds = getAllNewGenerationLawIds();

  it("no new-generation law id appears in LEGISLATION_ERA", () => {
    const offenders = newGenerationIds.filter((id) => id in LEGISLATION_ERA);
    expect(offenders).toEqual([]);
  });

  it("no new-generation law id appears in LEGISLATION_COST_CLASS", () => {
    const offenders = newGenerationIds.filter((id) => id in LEGISLATION_COST_CLASS);
    expect(offenders).toEqual([]);
  });
});
