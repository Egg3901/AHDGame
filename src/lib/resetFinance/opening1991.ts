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
import { bridgeOpeningLedger, type OpeningFiscalCorrection } from "./rules/openingLedger";

export type ResetOpeningCountry = "US" | "UK" | "JP";

const SOURCE_SIGNATURE: Record<
  ResetOpeningCountry,
  {
    revenue: number;
    spending: number;
    gdp: number;
    debt: number;
    ceiling: number;
    interest: number;
  }
> = {
  US: {
    revenue: 939_213_600_000,
    spending: 1_142_086_485_300,
    gdp: 6_200_000_000_000,
    debt: 3_665_000_000_000,
    ceiling: 4_145_000_000_000,
    interest: 0.075,
  },
  UK: {
    revenue: 229_306_050_000,
    spending: 209_473_475_000,
    gdp: 600_000_000_000,
    debt: 195_000_000_000,
    ceiling: 240_000_000_000,
    interest: 0.105,
  },
  JP: {
    revenue: 123_714_000_000_000,
    spending: 134_078_460_000_000,
    gdp: 470_000_000_000_000,
    debt: 167_000_000_000_000,
    ceiling: 195_000_000_000_000,
    interest: 0.058,
  },
};

const CORRECTIONS: Record<ResetOpeningCountry, readonly OpeningFiscalCorrection[]> = {
  US: [
    {
      id: "us_broadband_energy",
      revenueDelta: 0,
      spendingDelta: -16_038_457_200,
      reason: "Era-inactive broadband energy charge is not a 1991 obligation.",
    },
    {
      id: "us_paid_family_leave",
      revenueDelta: 0,
      spendingDelta: -98_349_030_000,
      reason: "Era-inactive paid leave charge is not a 1991 obligation.",
    },
  ],
  UK: [
    {
      id: "uk_state_pensions_continuity",
      revenueDelta: 0,
      spendingDelta: 34_045_750_000,
      reason: "Retain the 1991 pension obligation missing from the current national seed.",
    },
    {
      id: "uk_climate_net_zero",
      revenueDelta: 0,
      spendingDelta: -2_762_875_000,
      reason: "Remove the later-era net-zero program, not period energy obligations.",
    },
    {
      id: "uk_digital_broadband",
      revenueDelta: 0,
      spendingDelta: -124_775_000,
      reason: "Era-inactive digital broadband charge is not a 1991 obligation.",
    },
  ],
  JP: [
    {
      id: "jp_cybersecurity",
      revenueDelta: 0,
      spendingDelta: -223_200_000_000,
      reason: "Era-inactive cybersecurity charge is not a 1991 obligation.",
    },
    {
      id: "jp_digital_infrastructure",
      revenueDelta: 0,
      spendingDelta: -434_000_000_000,
      reason: "Era-inactive digital infrastructure charge is not a 1991 obligation.",
    },
    {
      id: "jp_digital_governance",
      revenueDelta: 0,
      spendingDelta: -471_200_000_000,
      reason: "Era-inactive digital governance charge is not a 1991 obligation.",
    },
    {
      id: "jp_regional_national_copies",
      revenueDelta: 0,
      spendingDelta: -12_400_000_000_000,
      reason: "Twelve regional service regimes cannot be booked twice nationally.",
    },
    {
      id: "jp_foreign_corporate_tax_selected_rate",
      revenueDelta: 282_000_000_000,
      spendingDelta: 0,
      reason: "The selected 39% 1991 rate replaces the generic 37% receipt assumption.",
    },
  ],
};

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
} as const;
const REGIONS_1991 = { US: states1991, UK: ukRegions1991, JP: jpRegions1991 } as const;

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
      const bridged = bridgeOpeningLedger(
        {
          revenue: budget.revenue.total,
          spendingIncludingInterest: budget.spending.total,
          gdp: budget.gdp,
          debt: budget.debt.principal,
          annualInterestRate: budget.debt.interestRate,
        },
        CORRECTIONS[country]
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
      }
  >;
}
