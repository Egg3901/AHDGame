import { describe, expect, it } from "vitest";
import { getCountryLayer1Model } from "@/lib/seeds/international";
import { deriveGranularElectorateUnits } from "@/lib/demographics/granularElectorate";
import { scoRegionCensusData } from "@/lib/seeds/sco/scoRegionCensusData";
import { walRegionCensusData } from "@/lib/seeds/wal/walRegionCensusData";
import { getUkModel } from "@/lib/seeds/international/uk";

const ERAS = ["1953", "1979", "1991", "1999", "2007", "2019", "2023"] as const;
const NATIONS = [
  { cc: "SCO", modern: scoRegionCensusData },
  { cc: "WAL", modern: walRegionCensusData },
] as const;
const DIMS = ["ethnicity", "age", "education", "income", "urbanization"] as const;

describe("devolved-nation Layer-1 models", () => {
  // The reason these exist. Without a model `deriveCellsForState` returns null
  // and the region falls through to the LEGACY archetype vote path — which is
  // what blocked deleting the archetype engine. It was never a rollback path;
  // it was Scotland and Wales's live vote path.
  it.each(NATIONS.map((n) => n.cc))("%s derives granular cells in every era", (cc) => {
    for (const era of ERAS) {
      const model = getCountryLayer1Model(cc, era)!;
      expect(model, `${cc} ${era} model`).toBeTruthy();
      for (const regionId of Object.keys(model.census)) {
        const derived = deriveGranularElectorateUnits(cc, regionId, `${era}-default`, null);
        expect(derived, `${cc} ${regionId} @ ${era}`).not.toBeNull();
        expect(derived!.units.length, `${cc} ${regionId} @ ${era} units`).toBeGreaterThan(0);
      }
    }
  });

  it.each(NATIONS.map((n) => n.cc))("%s census sums to 100 per dimension, every era", (cc) => {
    for (const era of ERAS) {
      const model = getCountryLayer1Model(cc, era)!;
      for (const [regionId, dims] of Object.entries(model.census)) {
        for (const dim of DIMS) {
          const total = Object.values((dims as Record<string, Record<string, number>>)[dim]).reduce(
            (s, v) => s + v,
            0
          );
          expect(total, `${cc} ${regionId} ${dim} @ ${era}`).toBeCloseTo(100, 6);
        }
      }
    }
  });

  // The hard invariant the era programme runs on: at an authored anchor the
  // output must equal the authored table. 2019 IS the authored census, so the
  // derivation has to be the identity there or it is quietly rewriting data.
  it.each(NATIONS)("$cc reproduces its authored census exactly at 2019", ({ cc, modern }) => {
    const model = getCountryLayer1Model(cc, "2019")!;
    for (const [regionId, authored] of Object.entries(modern)) {
      for (const dim of DIMS) {
        const got = (model.census[regionId] as Record<string, Record<string, number>>)[dim];
        for (const [key, value] of Object.entries(
          (authored as unknown as Record<string, Record<string, number>>)[dim]
        )) {
          expect(got[key], `${cc} ${regionId} ${dim}.${key}`).toBeCloseTo(value, 6);
        }
      }
    }
  });

  // Copying the modern census backwards would have put 36% graduates in
  // post-war Glasgow. The era level has to come from the UK's authored history.
  it.each(NATIONS.map((n) => n.cc))("%s tracks the era, not the present", (cc) => {
    const early = getCountryLayer1Model(cc, "1953")!;
    const modern = getCountryLayer1Model(cc, "2019")!;
    for (const regionId of Object.keys(early.census)) {
      const e = (early.census[regionId] as Record<string, Record<string, number>>).education;
      const m = (modern.census[regionId] as Record<string, Record<string, number>>).education;
      expect(e.degree_plus, `${cc} ${regionId} 1953 graduates`).toBeLessThan(m.degree_plus);
      expect(e.no_qualifications, `${cc} ${regionId} 1953 unqualified`).toBeGreaterThan(
        m.no_qualifications
      );
    }
  });

  // Their distinctive character must survive the projection, or they are just
  // the UK with different region ids.
  it("keeps each nation distinct from the UK in every era", () => {
    for (const era of ERAS) {
      const uk = getUkModel(era);
      const ukWhite = mean(uk.census, "ethnicity", "white_british");
      for (const { cc } of NATIONS) {
        const model = getCountryLayer1Model(cc, era)!;
        // Both are markedly less ethnically diverse than the UK as a whole.
        expect(mean(model.census, "ethnicity", "white_british"), `${cc} @ ${era}`).toBeGreaterThan(
          ukWhite
        );
      }
    }
  });

  it("shares the UK's voter groups rather than a second copy of them", () => {
    const uk = getUkModel("2019");
    for (const { cc } of NATIONS) {
      const model = getCountryLayer1Model(cc, "2019")!;
      expect(Object.keys(model.composition ?? {}).sort()).toEqual(
        Object.keys(uk.composition ?? {}).sort()
      );
      expect(model.dims).toEqual(uk.dims);
    }
  });
});

function mean(census: Record<string, unknown>, dim: string, key: string): number {
  const rows = Object.values(census) as Record<string, Record<string, number>>[];
  return rows.reduce((s, r) => s + (r[dim]?.[key] ?? 0), 0) / Math.max(1, rows.length);
}
