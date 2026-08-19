/**
 * Seeded legislation must aim its demographic effects at Layer-1 census
 * buckets, and at buckets the US electorate actually has.
 *
 * The vocabulary this replaces was not merely legacy, it was largely dead: of
 * the 80 seeded `groupId` entries, 63 named ids (`college`, `urban`, `rural`,
 * `poor`, `working_class`, …) that matched no archetype, no category group and
 * no bucket, so they had moved nothing at all for as long as the archetype
 * vocabulary had been the live one. A misspelt target reads exactly like a
 * working one, which is why this is a test rather than a review habit.
 */

import { describe, expect, it } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { turnoutTargetIdsForCountry } from "@/lib/demographics/turnoutTargets";

/**
 * This catalogue is mostly US law types but carries the `uk_` ones too, and the
 * two countries have different dimensions and different keys inside them
 * (`wealth:low` vs `income:low`). So a bucket is checked against the vocabulary
 * of the country whose prefix the law type carries, not against one fixed list.
 */
const TARGETS_BY_COUNTRY = new Map<string, Set<string>>([
  ["US", turnoutTargetIdsForCountry("US")],
  ["UK", turnoutTargetIdsForCountry("UK")],
]);

function targetsFor(legislationTypeId: string): Set<string> {
  const prefix = legislationTypeId.slice(0, legislationTypeId.indexOf("_")).toUpperCase();
  return TARGETS_BY_COUNTRY.get(prefix) ?? (TARGETS_BY_COUNTRY.get("US") as Set<string>);
}

describe("seeded legislation demographic effects", () => {
  it("author no archetype `groupId` targets", () => {
    const offenders = legislationTypes.flatMap((t) =>
      (t.demographicEffects ?? [])
        .filter((e) => e.groupId)
        .map((e) => `${t._id}: ${e.groupId as string}`)
    );
    expect(offenders).toEqual([]);
  });

  it("name a (dim, bucket) their country's electorate has", () => {
    const offenders = legislationTypes.flatMap((t) =>
      (t.demographicEffects ?? [])
        .filter((e) => !targetsFor(t._id).has(`${e.dim}:${e.bucket}`))
        .map((e) => `${t._id}: ${e.dim}:${e.bucket}`)
    );
    expect(offenders).toEqual([]);
  });

  it("never aim a bucket at the population channel", () => {
    // A bucket's population is the region's raked census marginal, so there is
    // nothing for a bill to move — see `DemographicEffect`'s doc comment.
    const offenders = legislationTypes.flatMap((t) =>
      (t.demographicEffects ?? [])
        .filter((e) => (e.target ?? "population") === "population")
        .map((e) => `${t._id}: ${e.dim}:${e.bucket}`)
    );
    expect(offenders).toEqual([]);
  });
});
