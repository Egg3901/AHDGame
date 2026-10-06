/**
 * The v2-only 1991 opening bridge from current seed books to the design's
 * reconciled legal obligations. This is not a v1 seed mutation or turn writer.
 * Source signatures force a review if the game's starting books change.
 */
import {
  generateStateBudgets,
  getInitialNationalBudgetsForPreset,
} from "@/lib/seeds/reference/budgets";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { ieRegions1991 } from "@/lib/countries/ie/data/ieRegions1991";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import sourceReferences from "@/lib/resetLegislation/openingLawReferences.json";
import { buildIeOpeningLawReferences1991 } from "@/lib/countries/ie/resetLegislation/openingIeReferences1991";
import { bridgeOpeningLedger, type OpeningFiscalCorrection } from "./rules/openingLedger";
import {
  SOURCE_SIGNATURE,
  STANDALONE_CONTINUITY,
  fitReviewedOpeningClaims1991,
} from "./rules/openingSourceClaims1991";

export type ResetOpeningCountry = "US" | "UK" | "JP" | "IE";

const REGIONAL_ENVELOPE = {
  US: {
    grants: 64_962_000_000,
    regionalOwnRevenue: 461_771_550_000,
    regionalSpending: 526_733_550_000,
  },
  UK: {
    grants: 16_399_000_000,
    regionalOwnRevenue: 21_130_400_000,
    regionalSpending: 30_656_400_000,
  },
  JP: {
    grants: 15_872_000_000_000,
    regionalOwnRevenue: 19_029_600_000_000,
    regionalSpending: 26_958_600_000_000,
  },
  IE: {
    grants: 0,
    regionalOwnRevenue: 1_284_360_000,
    regionalSpending: 2_201_760_000,
  },
} as const;
const REGIONS_1991 = {
  US: states1991,
  UK: ukRegions1991,
  JP: jpRegions1991,
  IE: ieRegions1991,
} as const;
const reviewedSourceReferences = [...sourceReferences, ...buildIeOpeningLawReferences1991()];

export function openingFiscalBooks1991() {
  const seeded = new Map(
    getInitialNationalBudgetsForPreset("1991-default").map((budget) => [budget.countryId, budget])
  );
  return Object.fromEntries(
    (Object.keys(SOURCE_SIGNATURE) as ResetOpeningCountry[]).map((country) => {
      const budget = seeded.get(country);
      const signature = SOURCE_SIGNATURE[country];
      if (
        !budget ||
        budget.revenue.total !== signature.revenue ||
        budget.spending.total !== signature.spending ||
        budget.gdp !== signature.gdp ||
        budget.debt.principal !== signature.debt ||
        budget.debt.ceiling !== signature.ceiling ||
        budget.debt.interestRate !== signature.interest
      ) {
        throw new Error(`${country} 1991 seed book changed; review the v2 fiscal bridge`);
      }
      // The legal crosswalk already excludes future statutes and duplicate
      // national copies. Fund that reviewed mix once; the source seed itself
      // now enforces era availability, so old absolute corrections cannot be
      // subtracted a second time. Receipts and historical debt stay untouched.
      const fitted = fitReviewedOpeningClaims1991(country, reviewedSourceReferences);
      const corrections: OpeningFiscalCorrection[] = [
        {
          id:
            country === COUNTRY_CONFIGS.UK.id
              ? "uk_state_pensions_continuity"
              : `${country.toLowerCase()}_1991_source_obligations`,
          revenueDelta: 0,
          spendingDelta:
            fitted.sourceOperating + budget.spending.debtInterest - budget.spending.total,
          reason:
            country === COUNTRY_CONFIGS.UK.id
              ? "Reconcile the reviewed period pension, continuity obligations and named transfers once."
              : "Reconcile reviewed period obligations after excluding future statutes and duplicate national copies.",
        },
        {
          id: `${country.toLowerCase()}_1991_affordable_programs`,
          revenueDelta: 0,
          spendingDelta: fitted.operating - fitted.sourceOperating,
          reason:
            "Resize real program allocations after historical coupons and protected transfers within the 0.5%-GDP opening deficit limit.",
        },
      ];
      const bridged = bridgeOpeningLedger(
        {
          revenue: Math.round(budget.revenue.total),
          spendingIncludingInterest: budget.spending.total,
          gdp: Math.round(budget.gdp),
          debt: budget.debt.principal,
          annualInterestRate: budget.debt.interestRate,
        },
        corrections
      );
      const envelope = REGIONAL_ENVELOPE[country];
      const genericRegional = generateStateBudgets(
        REGIONS_1991[country].map((region) => ({
          id: region._id,
          countryId: region.countryId,
          population: region.population,
          gdp: region.gdp,
        })),
        budget.fiscalYear
      );
      const regionalOwnRevenue = genericRegional.reduce(
        (sum, region) => sum + region.revenue.total - region.revenue.federalGrants,
        0
      );
      const regionalSpending = genericRegional.reduce(
        (sum, region) => sum + region.spending.total,
        0
      );
      if (
        regionalOwnRevenue !== envelope.regionalOwnRevenue ||
        regionalSpending !== envelope.regionalSpending
      ) {
        throw new Error(`${country} 1991 regional books changed; review the v2 fiscal bridge`);
      }
      if (envelope.grants > bridged.operating) {
        throw new Error(`${country} regional grants exceed national operating claims`);
      }
      return [
        country,
        {
          ...bridged,
          programCostScale: fitted.programCostScale,
          sourceAllocations: fitted.sourceAllocations,
          standaloneContinuity: STANDALONE_CONTINUITY[country].map((account) => ({
            ...account,
            amount: fitted.sourceAllocations[account.sourceId]!,
          })),
          grants: envelope.grants,
          regionalOwnRevenue: envelope.regionalOwnRevenue,
          regionalSpending: envelope.regionalSpending,
          debtCeiling: budget.debt.ceiling,
          interestRate: budget.debt.interestRate,
        },
      ];
    })
  ) as Record<
    ResetOpeningCountry,
    ReturnType<typeof bridgeOpeningLedger> &
      (typeof REGIONAL_ENVELOPE)[ResetOpeningCountry] & {
        debtCeiling: number;
        interestRate: number;
        programCostScale: number;
        sourceAllocations: Record<string, number>;
        standaloneContinuity: { id: string; sourceId: string; amount: number }[];
      }
  >;
}
