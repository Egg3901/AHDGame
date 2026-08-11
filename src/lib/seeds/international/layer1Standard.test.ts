/**
 * Layer-1 seed standardization audit — permanent guard.
 *
 * Validates every country model returned by getCountryLayer1Model so that
 * generic granular poll derivation can treat each declared partition dimension
 * as a reliable marginal:
 *   - marginal shares sum to 100 +/- 2 in every region
 *   - every census bucket has a position entry (econ/social lean)
 *   - every census bucket has a turnout rate
 *   - dimension names and bucket keys are consistent across regions
 *
 * Non-partition overlay dimensions (e.g. US ideology, which is not in the
 * international registry) must be explicitly excluded from partition checks.
 * Currently no international model uses overlay dims, so the allowlist is empty.
 */

import { describe, it, expect } from "vitest";
import { getCountryLayer1Model } from "./index";
import type { EraId } from "@/lib/seeds/presetSelector";

const COUNTRY_CODES = [
  "UK",
  "DE",
  "JP",
  "IE",
  "BR",
  "CN",
  "NG",
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DD",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BLR",
  "CS",
  "BAL",
] as const;

const ERAS: EraId[] = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"];

/**
 * Overlay-style dimensions are present in positions/turnout but NOT as census
 * marginals, so they must be skipped when checking marginal sums and regional
 * consistency. No international model currently uses overlays.
 */
const OVERLAY_DIM_ALLOWLIST: Record<string, string[]> = {};

const MARGINAL_TOLERANCE = 2;

function getPartitionDims(model: ReturnType<typeof getCountryLayer1Model>): string[] {
  if (!model) return [];
  const allowed = new Set(OVERLAY_DIM_ALLOWLIST[model.countryId] ?? []);
  return model.dims.filter((d) => !allowed.has(d));
}

describe("Layer-1 seed standardization audit", () => {
  for (const cc of COUNTRY_CODES) {
    describe(`${cc}`, () => {
      for (const era of ERAS) {
        describe(`${era}`, () => {
          const model = getCountryLayer1Model(cc, era);

          it("returns a model", () => {
            expect(model).not.toBeNull();
          });

          if (!model) return;

          const partitionDims = getPartitionDims(model);
          const regions = Object.keys(model.census);

          it("has at least one region", () => {
            expect(regions.length).toBeGreaterThan(0);
          });

          it("declares partition dims", () => {
            expect(partitionDims.length).toBeGreaterThan(0);
          });

          it("every region declares exactly the same partition dims", () => {
            for (const region of regions) {
              const actualDims = Object.keys(model.census[region] ?? {}).sort();
              expect(
                actualDims,
                `${cc}.${era}.${region}: partition dims differ from model.dims`
              ).toEqual([...partitionDims].sort());
            }
          });

          it("partition marginal shares sum to 100 +/- 2 for every region", () => {
            for (const region of regions) {
              for (const dim of partitionDims) {
                const vals = Object.values(model.census[region]?.[dim] ?? {});
                const sum = vals.reduce((a, b) => a + (b as number), 0);
                expect(
                  sum,
                  `${cc}.${era}.${region}.${dim} marginal sum = ${sum}`
                ).toBeGreaterThanOrEqual(100 - MARGINAL_TOLERANCE);
                expect(
                  sum,
                  `${cc}.${era}.${region}.${dim} marginal sum = ${sum}`
                ).toBeLessThanOrEqual(100 + MARGINAL_TOLERANCE);
              }
            }
          });

          it("bucket keys are consistent across regions within each partition dim", () => {
            for (const dim of partitionDims) {
              let expectedKeys: string[] | null = null;
              for (const region of regions) {
                const keys = Object.keys(model.census[region]?.[dim] ?? {}).sort();
                if (expectedKeys === null) {
                  expectedKeys = keys;
                } else {
                  expect(
                    keys,
                    `${cc}.${era}.${region}.${dim} bucket keys differ from first region`
                  ).toEqual(expectedKeys);
                }
              }
            }
          });

          it("every census bucket has a position entry", () => {
            for (const dim of partitionDims) {
              const allKeys = new Set<string>();
              for (const region of regions) {
                for (const key of Object.keys(model.census[region]?.[dim] ?? {})) {
                  allKeys.add(key);
                }
              }
              for (const key of allKeys) {
                expect(
                  model.positions[dim]?.[key],
                  `${cc}.${era}.${dim}.${key}: missing position`
                ).toBeDefined();
                expect(
                  model.positions[dim]?.[key]?.economicLean,
                  `${cc}.${era}.${dim}.${key}: missing economicLean`
                ).not.toBeUndefined();
                expect(
                  model.positions[dim]?.[key]?.socialLean,
                  `${cc}.${era}.${dim}.${key}: missing socialLean`
                ).not.toBeUndefined();
              }
            }
          });

          it("every census bucket has a turnout rate", () => {
            for (const dim of partitionDims) {
              const allKeys = new Set<string>();
              for (const region of regions) {
                for (const key of Object.keys(model.census[region]?.[dim] ?? {})) {
                  allKeys.add(key);
                }
              }
              for (const key of allKeys) {
                expect(
                  model.turnoutRates[dim]?.[key],
                  `${cc}.${era}.${dim}.${key}: missing turnout rate`
                ).not.toBeUndefined();
              }
            }
          });
        });
      }
    });
  }
});
