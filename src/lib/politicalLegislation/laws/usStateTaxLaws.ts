/**
 * US state-level tax sliders — regional sidecar, not part of the locked
 * 109-law core. The new-generation federal catalog only carries national
 * tax sliders (`allowedScope: "national"`), so governors and state
 * legislatures had a Tax category with nothing to pick (ticket #1106).
 *
 * Baseline rates match `generateStateBudgets` US defaults so day-one
 * stateBudgets.taxRates stay the source of truth (tax laws seed neither
 * statePolicies nor enactedLaws).
 */

import type { PoliticalLaw, TaxPolicy } from "../types";

/** US defaults from generateStateBudgets. */
export const US_STATE_TAX_BASELINES = {
  incomeTax: 5,
  salesTax: 6,
  domesticCorporateTax: 6,
  foreignCorporateTax: 6,
  propertyTax: 1,
} as const;

function stateTaxLaw(args: {
  slug: string;
  taxType: TaxPolicy["taxType"];
  title: string;
  description: string;
  minRate: number;
  maxRate: number;
  step: number;
  baselineRate: number;
  waypoints: TaxPolicy["waypoints"];
}): PoliticalLaw {
  return {
    id: `us.tax.${args.slug}`,
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "state",
      taxType: args.taxType,
      minRate: args.minRate,
      maxRate: args.maxRate,
      step: args.step,
      baselineRate: args.baselineRate,
      waypoints: args.waypoints,
    },
    title: args.title,
    description: args.description,
    category: "economy",
    allowedScope: "regional",
  };
}

export const US_STATE_TAX_LAWS: PoliticalLaw[] = [
  stateTaxLaw({
    slug: "stateIncomeTax",
    taxType: "incomeTax",
    title: "State Income Tax Rate",
    description:
      "The state's levy on personal incomes, from a no-income-tax commonwealth to a steeply graduated schedule.",
    minRate: 0,
    maxRate: 25,
    step: 0.5,
    baselineRate: US_STATE_TAX_BASELINES.incomeTax,
    waypoints: [
      { rate: 0, label: "Income Tax Free" },
      { rate: 2, label: "Token Levy" },
      { rate: 5, label: "Modest Schedule" },
      { rate: 9, label: "Standard Schedule" },
      { rate: 14, label: "Elevated Schedule" },
      { rate: 20, label: "High-Investment Schedule" },
      { rate: 25, label: "Maximum Schedule" },
    ],
  }),
  stateTaxLaw({
    slug: "stateSalesTax",
    taxType: "salesTax",
    title: "State Sales Tax Rate",
    description:
      "The state's tax on retail purchases, from a sales-tax-free commonwealth to a consumption-first revenue base.",
    minRate: 0,
    maxRate: 15,
    step: 0.5,
    baselineRate: US_STATE_TAX_BASELINES.salesTax,
    waypoints: [
      { rate: 0, label: "Sales Tax Free" },
      { rate: 3, label: "Light Levy" },
      { rate: 6, label: "Standard Levy" },
      { rate: 9, label: "Broad-Base Levy" },
      { rate: 12, label: "Consumption-First" },
      { rate: 15, label: "Maximum Levy" },
    ],
  }),
  stateTaxLaw({
    slug: "stateDomesticCorporateTax",
    taxType: "domesticCorporateTax",
    title: "State Corporate Tax Rate",
    description: "The state's tax on profits of corporations headquartered in the United States.",
    minRate: 0,
    maxRate: 20,
    step: 0.5,
    baselineRate: US_STATE_TAX_BASELINES.domesticCorporateTax,
    waypoints: [
      { rate: 0, label: "No Corporate Levy" },
      { rate: 3, label: "Light Assessment" },
      { rate: 6, label: "Standard Assessment" },
      { rate: 10, label: "Expanded Assessment" },
      { rate: 15, label: "Heavy Assessment" },
      { rate: 20, label: "Maximum Assessment" },
    ],
  }),
  stateTaxLaw({
    slug: "stateForeignCorporateTax",
    taxType: "foreignCorporateTax",
    title: "State Foreign Corporation Tax Rate",
    description:
      "The state's tax on profits of corporations headquartered outside the United States.",
    minRate: 0,
    maxRate: 20,
    step: 0.5,
    baselineRate: US_STATE_TAX_BASELINES.foreignCorporateTax,
    waypoints: [
      { rate: 0, label: "Exempt Foreign Enterprise" },
      { rate: 3, label: "Light Assessment" },
      { rate: 6, label: "Parity Assessment" },
      { rate: 10, label: "Elevated Assessment" },
      { rate: 15, label: "Punitive Assessment" },
      { rate: 20, label: "Maximum Assessment" },
    ],
  }),
  stateTaxLaw({
    slug: "statePropertyTax",
    taxType: "propertyTax",
    title: "State Property Tax Rate",
    description:
      "The state's levy on assessed property value, funding local services and capital works.",
    minRate: 0,
    maxRate: 4,
    step: 0.1,
    baselineRate: US_STATE_TAX_BASELINES.propertyTax,
    waypoints: [
      { rate: 0, label: "No Property Levy" },
      { rate: 0.5, label: "Light Assessment" },
      { rate: 1, label: "Standard Assessment" },
      { rate: 2, label: "Expanded Assessment" },
      { rate: 3, label: "Heavy Assessment" },
      { rate: 4, label: "Maximum Assessment" },
    ],
  }),
];
