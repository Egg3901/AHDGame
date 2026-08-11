import type { EraId } from "@/lib/seeds/presetSelector";
import type { CountryLayer1Model } from "@/lib/seeds/international/types";
import type { UKRegionLayer1 } from "@/lib/seeds/uk/ukRegionCensusData";
import { getUkModel } from "@/lib/seeds/international/uk";

/**
 * Layer-1 models for the UK's devolved nations.
 *
 * Scotland and Wales run the UK's twelve voter groups and the same five census
 * dimensions, but had no Layer-1 model of their own. That mattered beyond
 * tidiness: `deriveCellsForState` returns null without one, so both fell through
 * to the LEGACY archetype vote path — which is why the archetype engine could
 * not be deleted. It was not a rollback path, it was their live vote path.
 *
 * ERA DERIVATION
 * --------------
 * They have one authored census apiece (modern), and the UK has seven. Rather
 * than hand-invent ~455 historical distributions, each era is derived by taking
 * the nation's MEASURED modern deviation from the modern UK and applying it to
 * that era's UK census.
 *
 * That is defensible in a way inventing absolute values would not be: what is
 * stable about Scotland relative to England is structural and slow-moving — more
 * White British, more rural in the Highlands, a different education mix — while
 * the absolute levels (graduate share, ethnic diversity) move enormously between
 * 1953 and 2023. Anchoring the RATIO and letting the UK's authored era data carry
 * the level keeps both halves honest, and means a correction to a UK era census
 * automatically propagates.
 *
 * The alternative — copying the modern census into 1953 — would have put 36%
 * graduates in post-war Glasgow.
 */

type Dim = keyof UKRegionLayer1;
const DIMS: Dim[] = ["ethnicity", "age", "education", "income", "urbanization"];

/** Population-weighted mean of a nation's regions, per dimension bucket. */
function nationalMean(
  census: Record<string, UKRegionLayer1>
): Record<string, Record<string, number>> {
  const regions = Object.values(census);
  const out: Record<string, Record<string, number>> = {};
  for (const dim of DIMS) {
    const sums: Record<string, number> = {};
    for (const region of regions) {
      for (const [key, v] of Object.entries(region[dim] as Record<string, number>)) {
        sums[key] = (sums[key] ?? 0) + v;
      }
    }
    out[dim] = Object.fromEntries(
      Object.entries(sums).map(([k, v]) => [k, v / Math.max(1, regions.length)])
    );
  }
  return out;
}

/** Renormalise a bucket distribution to sum to 100. */
function normalise(dist: Record<string, number>): Record<string, number> {
  const total = Object.values(dist).reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return dist;
  return Object.fromEntries(
    Object.entries(dist).map(([k, v]) => [k, (Math.max(0, v) / total) * 100])
  );
}

/**
 * Apply a region's modern ratio-to-UK onto an era's UK national mean.
 *
 * Ratios rather than differences: a difference of +12pp White British is
 * meaningless against a 1953 UK that was already 99% White British, and would
 * push past 100. A ratio degrades gracefully at both ends and renormalising
 * restores the sum.
 */
function projectRegion(
  modernRegion: UKRegionLayer1,
  modernUkMean: Record<string, Record<string, number>>,
  eraUkMean: Record<string, Record<string, number>>
): UKRegionLayer1 {
  const out: Record<string, Record<string, number>> = {};
  for (const dim of DIMS) {
    const region = modernRegion[dim] as Record<string, number>;
    const modern = modernUkMean[dim] ?? {};
    const era = eraUkMean[dim] ?? {};
    const projected: Record<string, number> = {};
    for (const [key, regionVal] of Object.entries(region)) {
      const modernVal = modern[key] ?? 0;
      const eraVal = era[key] ?? 0;
      // No modern UK signal for this bucket — keep the era level rather than
      // scaling by an undefined ratio.
      projected[key] = modernVal > 0 ? eraVal * (regionVal / modernVal) : eraVal;
    }
    out[dim] = normalise(projected);
  }
  return out as unknown as UKRegionLayer1;
}

/**
 * Era census for a devolved nation, derived from its modern authored census and
 * the UK's authored census for that era.
 */
export function deriveDevolvedCensus(
  modernCensus: Record<string, UKRegionLayer1>,
  era: EraId
): Record<string, UKRegionLayer1> {
  const modernUk = ukEraCensus("2019");
  const eraUk = ukEraCensus(era);
  const modernUkMean = nationalMean(modernUk);
  const eraUkMean = nationalMean(eraUk);
  return Object.fromEntries(
    Object.entries(modernCensus).map(([regionId, region]) => [
      regionId,
      projectRegion(region, modernUkMean, eraUkMean),
    ])
  );
}

/**
 * The UK's census for an era, back in `UKRegionLayer1` shape.
 *
 * `getUkModel` returns it already flattened to the generic model form, so this
 * reads it back rather than re-importing the seven era files — one source, and a
 * corrected UK era census reaches the devolved nations automatically.
 */
function ukEraCensus(era: EraId): Record<string, UKRegionLayer1> {
  const model = getUkModel(era);
  return Object.fromEntries(
    Object.entries(model.census).map(([regionId, dims]) => [
      regionId,
      dims as unknown as UKRegionLayer1,
    ])
  );
}

/**
 * Build a devolved nation's Layer-1 model: its own census, everything else
 * inherited from the UK for that era.
 *
 * Positions, turnout rates and composition are deliberately shared. Scotland
 * and Wales use the UK's twelve voter groups, so authoring separate tables would
 * be a second copy of the same judgement calls, free to drift — the mistake
 * `archetypeBucketMap.ts` already made once.
 */
export function makeDevolvedNationModel(
  countryId: string,
  modernCensus: Record<string, UKRegionLayer1>,
  era: EraId
): CountryLayer1Model {
  const uk = getUkModel(era);
  const census = deriveDevolvedCensus(modernCensus, era);
  return {
    ...uk,
    countryId,
    census: Object.fromEntries(
      Object.entries(census).map(([regionId, layer1]) => [
        regionId,
        {
          ethnicity: layer1.ethnicity as unknown as Record<string, number>,
          age: layer1.age as unknown as Record<string, number>,
          education: layer1.education as unknown as Record<string, number>,
          income: layer1.income as unknown as Record<string, number>,
          urbanization: layer1.urbanization as unknown as Record<string, number>,
        },
      ])
    ),
  };
}
