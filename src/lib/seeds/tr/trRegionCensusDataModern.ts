/**
 * Turkey Layer-1 modern census proxy profile, sourced primarily from 2023 national data.
 * All eight game regions share national age, education, urbanity, and ethnicity profiles;
 * these are explicitly not observed regional compositions. The 2019 and 2027 presets
 * project this 2023 weighting vintage and do not claim year-specific census observations.
 *
 * Age: TurkStat ABPRS 2023 resident population, reference date 31 Dec 2023, all eligible
 * residents; exact national 18+ cohorts from 15-19 less the matching 15-17 child count,
 * then five-year age bins. Adult denominator 63,166,343. Province single-age data was
 * unavailable, so the same national profile is used in each macro-region.
 * Education: TurkStat National Education Statistics 2023, population 25+, citizens only.
 * Shares are primary-or-below 28.9, secondary 45.9, tertiary 24.4, unknown 0.7; rounded
 * source values sum to 99.9. The known categories sum to 99.2 and are normalized into the
 * three matching runtime groups. Runtime vocational is zero because this source does not
 * disaggregate it from the broader measured categories; this is not a claim of zero
 * vocational attainment. It is a documented schema/source crosswalk.
 * Urbanity: TurkStat 2022 grid-based Degree of Urbanisation (DEGURBA), national shares;
 * dense/intermediate/thinly-populated are mapped to urban/suburban/rural.
 * Ethnicity: KONDA July 2019 adult self-identification survey, national profile; Turkish
 * 80%, Kurdish 14%, with Zaza/Arab/other aggregated into runtime other 6%. Survey estimate,
 * not census data. It is copied nationally; no regional ethnic counts are inferred.
 * Income: the existing region-specific 1979 income distribution is retained as an explicit
 * gameplay carry-forward until a dated regional distribution is sourced.
 *
 * Primary sources: ABPRS 2023 (#49684), https://veriportali.tuik.gov.tr/en/press/49684;
 * National Education Statistics 2023 (#53444), https://veriportali.tuik.gov.tr/en/press/53444;
 * Urban-Rural Population Statistics 2022, https://veriportali.tuik.gov.tr/en/press/49755;
 * KONDA July 2019 Barometre 100, https://konda.com.tr/uploads/981457a746a6975938fa81405226e03210051660e1623f875d60dabb6b4efc56/1907temmuz-barometre-100.pdf.
 * The child 15-17 denominator is TurkStat Statistics on Child 2023, table 1.8.
 * https://veriportali.tuik.gov.tr/api/en/data/downloads?p=lmqpPsgNhvO29tzfBl6xp1wqrbe2eSJlYR2nUSV5h3p8ZrGDI6FfCT1sCRedtmR6r7IHCMYvJ0z3fNNVpQGm8Q%3D%3D&t=y
 * Source availability differs by endpoint; URLs identify publications, not a live fetch contract.
 */
import { trRegionCensusData } from "./trRegionCensusData";
import type { TRRegionLayer1 } from "./trRegionCensusData";

const NATIONAL_ADULT_COUNTS = {
  young: 15_520_699,
  mid: 19_161_049,
  mature: 19_761_789,
  senior: 8_722_806,
} as const;
const NATIONAL_ADULT_TOTAL = 63_166_343;

/** Exact national adult shares (percent); normalized from matching-count cohorts. */
export const TR_MODERN_AGE_SHARES = Object.fromEntries(
  Object.entries(NATIONAL_ADULT_COUNTS).map(([key, count]) => [
    key,
    (count / NATIONAL_ADULT_TOTAL) * 100,
  ])
) as { young: number; mid: number; mature: number; senior: number };

const KNOWN_EDUCATION_TOTAL = 28.9 + 45.9 + 24.4;
/** Known 25+ categories mapped to runtime primary/secondary/university, then normalized. */
export const TR_MODERN_EDUCATION_SHARES = {
  primary_or_below: (28.9 / KNOWN_EDUCATION_TOTAL) * 100,
  secondary: (45.9 / KNOWN_EDUCATION_TOTAL) * 100,
  vocational: 0,
  university: (24.4 / KNOWN_EDUCATION_TOTAL) * 100,
} as const;

export const TR_MODERN_URBANIZATION_SHARES = {
  urban: 67.9,
  suburban: 14.8,
  rural: 17.3,
} as const;

export const TR_MODERN_ETHNICITY_SHARES = {
  turkish: 80,
  kurdish: 14,
  other: 6,
} as const;

export const trRegionCensusDataModern: Record<string, TRRegionLayer1> = Object.fromEntries(
  Object.entries(trRegionCensusData).map(([regionId, legacy]) => [
    regionId,
    {
      ethnicity: { ...TR_MODERN_ETHNICITY_SHARES },
      age: { ...TR_MODERN_AGE_SHARES },
      education: { ...TR_MODERN_EDUCATION_SHARES },
      income: { ...legacy.income },
      urbanization: { ...TR_MODERN_URBANIZATION_SHARES },
    },
  ])
) as Record<string, TRRegionLayer1>;
