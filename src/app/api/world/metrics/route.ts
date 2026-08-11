import { NextResponse } from "next/server";
import { findMergedRegionMetricsManyForDisplay } from "@/lib/macroMetrics/displayMerge";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { StateMetrics, MetricCategoryId } from "@/lib/db/types";
import { NATIONAL_SCOPE } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { resolveGameYear } from "@/lib/era/era";
import { isMetricActive } from "@/lib/era/metricCatalog";
import { scoreMetric } from "@/lib/utils/metricScoring";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/** Maps CountryId → ISO 3166-1 numeric code used by the world map */
const COUNTRY_TO_ISO: Record<string, string> = {
  US: "840",
  UK: "826",
  DE: "276",
  JP: "392",
};

const ALL_CATEGORIES: MetricCategoryId[] = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "population",
  "mediaInformation",
];

/**
 * GET /api/world/metrics
 *
 * Returns national-level aggregated metrics for every country that has data.
 * Response is keyed by ISO numeric code (matching the world map's country IDs).
 *
 * Query params:
 *   category  – optional MetricCategoryId to filter to a single category
 *   metric    – optional metricId within that category (requires category)
 *
 * Shape:
 * {
 *   countries: {
 *     "840": {
 *       countryId: "US",
 *       name: "United States",
 *       hasData: true,
 *       categories: {
 *         economic: {
 *           unemploymentRate: { value: 4.5, score: 81 },
 *           ...
 *         },
 *         ...
 *       },
 *       categoryScores: { economic: 72, education: 65, ... },
 *       overallScore: 68
 *     }
 *   },
 *   availableCategories: ["economic", ...],
 *   availableMetrics: { economic: ["unemploymentRate", ...], ... }
 * }
 */
// GET /api/world/metrics — Returns national-level aggregated metrics for every country, optionally filtered by category and metric.
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const categoryFilter = searchParams.get("category") as MetricCategoryId | null;
    const metricFilter = searchParams.get("metric");

    const db = await getDb();

    // Preset drives the era-scaled median-income band (global game setting);
    // the era fields drive era-aware score-band drift when the flag is on.
    const gameStateDoc = await db
      .collection<{
        _id: string;
        preset?: string;
        currentYear?: number;
        currentTurn?: number;
        startingYear?: number;
        eraSystemEnabled?: boolean;
        incomeBandIndexByCountry?: Partial<Record<string, number>>;
      }>("gameState")
      .findOne({ _id: "current" });
    const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
    // Live year for era-aware score bands; null while the flag is off.
    const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
    // medianIncome era band inputs (null flag-off ⇒ legacy band).
    const startingYear = year != null ? (gameStateDoc?.startingYear ?? null) : null;
    const incomeIndexByCountry =
      year != null ? (gameStateDoc?.incomeBandIndexByCountry ?? null) : null;

    // Fetch all national-scope documents
    const nationalDocIds = Object.keys(NATIONAL_SCOPE);
    // SP5: merged two-store national views (macro + non-playable political).
    const nationalDocs = await findMergedRegionMetricsManyForDisplay(db, {
      _id: { $in: nationalDocIds },
    });

    const categories = categoryFilter ? [categoryFilter] : ALL_CATEGORIES;

    // Build available metrics map by merging keys from all country docs.
    // Era existence gate: a metric inactive in EVERY listed country is dropped
    // from the pickers (per-country docs are additionally gated below).
    const availableMetrics: Record<string, string[]> = {};
    for (const cat of ALL_CATEGORIES) {
      const keys = new Set<string>();
      for (const doc of nationalDocs) {
        const catData = doc[cat];
        const docCountry = NATIONAL_SCOPE[String(doc._id)];
        if (catData) {
          for (const k of Object.keys(catData)) {
            if (isMetricActive(k, docCountry, year)) keys.add(k);
          }
        }
      }
      if (keys.size > 0) availableMetrics[cat] = Array.from(keys);
    }

    // Build per-country response
    const countries: Record<
      string,
      {
        countryId: string;
        name: string;
        hasData: boolean;
        categories: Record<string, Record<string, { value: number; score: number | null }>>;
        categoryScores: Record<string, number | null>;
        overallScore: number | null;
      }
    > = {};

    for (const [docId, countryId] of Object.entries(NATIONAL_SCOPE)) {
      const isoCode = COUNTRY_TO_ISO[countryId];
      if (!isoCode) continue;

      const doc = nationalDocs.find((d) => String(d._id) === docId);
      const config = COUNTRY_CONFIGS[countryId];

      if (!doc) {
        countries[isoCode] = {
          countryId,
          name: config?.name ?? countryId,
          hasData: false,
          categories: {},
          categoryScores: {},
          overallScore: null,
        };
        continue;
      }

      const catData: Record<string, Record<string, { value: number; score: number | null }>> = {};
      const catScores: Record<string, number | null> = {};
      let totalScore = 0;
      let totalCount = 0;

      for (const cat of categories) {
        const metrics = doc[cat];
        if (!metrics) continue;

        const metricEntries: Record<string, { value: number; score: number | null }> = {};
        let catScoreSum = 0;
        let catScoreCount = 0;

        const metricKeys =
          metricFilter && categoryFilter === cat ? [metricFilter] : Object.keys(metrics);

        for (const key of metricKeys) {
          // Era existence gate: inactive metrics are omitted from the response
          // entirely (not just unscored).
          if (!isMetricActive(key, countryId, year)) continue;
          const mv = (metrics as Record<string, { value: number }>)[key];
          if (!mv) continue;
          const score = scoreMetric(
            key,
            mv.value,
            countryId,
            preset,
            year,
            incomeIndexByCountry?.[countryId] ?? null,
            startingYear
          );
          metricEntries[key] = { value: mv.value, score };
          if (score !== null) {
            catScoreSum += score;
            catScoreCount++;
          }
        }

        catData[cat] = metricEntries;
        const avgScore = catScoreCount > 0 ? Math.round(catScoreSum / catScoreCount) : null;
        catScores[cat] = avgScore;
        if (avgScore !== null) {
          totalScore += avgScore;
          totalCount++;
        }
      }

      countries[isoCode] = {
        countryId,
        name: config?.name ?? countryId,
        hasData: true,
        categories: catData,
        categoryScores: catScores,
        overallScore: totalCount > 0 ? Math.round(totalScore / totalCount) : null,
      };
    }

    const response = NextResponse.json({
      countries,
      availableCategories: ALL_CATEGORIES,
      availableMetrics,
    });
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=900, no-transform"
    );
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
