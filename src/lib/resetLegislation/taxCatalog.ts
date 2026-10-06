/**
 * The reset tax menu retains the existing tax instruments. Tax bills choose an
 * exact percentage; ideological law levels never substitute for a tax rate.
 * UK 1991 regional council/property taxation needs a historical fixture and
 * is deliberately not offered through this menu yet.
 */
import type { ResetCountry } from "./fundingOwner";

export type TaxScope = "national" | "regional";
export type ResetTaxType =
  | "incomeTax"
  | "domesticCorporateTax"
  | "foreignCorporateTax"
  | "payrollTax"
  | "salesTax"
  | "tariffs"
  | "propertyTax"
  | "residentTax"
  | "fixedAssetTax";

export interface ResetTaxDefinition {
  id: string;
  title: string;
  taxType: ResetTaxType;
  country: ResetCountry;
  scope: TaxScope;
  existingLegislationTypeId: string;
  overseeingSeatId: string | null;
}

const federal: ReadonlyArray<[string, string, ResetTaxType, string, string, string]> = [
  [
    "T01",
    "Income tax",
    "incomeTax",
    "us_federal_income_tax_rate",
    "uk_income_tax_rate",
    "jp_income_tax_rate",
  ],
  [
    "T02",
    "Domestic corporate tax",
    "domesticCorporateTax",
    "us_federal_domestic_corporate_tax_rate",
    "uk_domestic_corporation_tax",
    "jp_domestic_corporation_tax",
  ],
  [
    "T03",
    "Foreign corporate tax",
    "foreignCorporateTax",
    "us_federal_foreign_corporate_tax_rate",
    "uk_foreign_corporation_tax",
    "jp_foreign_corporation_tax",
  ],
  [
    "T04",
    "Payroll tax",
    "payrollTax",
    "us_federal_payroll_tax_rate",
    "uk_national_insurance",
    "jp_social_insurance",
  ],
  [
    "T05",
    "Sales or consumption tax",
    "salesTax",
    "us_federal_sales_tax_rate",
    "uk_vat",
    "jp_consumption_tax",
  ],
  ["T06", "Tariffs", "tariffs", "us_federal_tariff_rate", "uk_excise_customs", "jp_customs_tariff"],
];

const treasurySeat: Record<ResetCountry, string> = {
  US: "secretary_of_treasury",
  UK: "chancellor",
  JP: "finance_minister",
  IE: "minister_for_finance",
  SCO: "financeSecretary",
  WAL: "financeSecretary",
};

const nationalTaxes: ResetTaxDefinition[] = federal.flatMap(([id, title, taxType, us, uk, jp]) => [
  {
    id,
    title,
    taxType,
    country: "US",
    scope: "national",
    existingLegislationTypeId: us,
    overseeingSeatId: treasurySeat.US,
  },
  {
    id,
    title,
    taxType,
    country: "UK",
    scope: "national",
    existingLegislationTypeId: uk,
    overseeingSeatId: treasurySeat.UK,
  },
  {
    id,
    title,
    taxType,
    country: "JP",
    scope: "national",
    existingLegislationTypeId: jp,
    overseeingSeatId: treasurySeat.JP,
  },
  {
    id,
    title,
    taxType,
    country: "IE",
    scope: "national",
    existingLegislationTypeId: (
      {
        T01: "ie_income_tax_rate",
        T02: "ie_corporate_tax_rate",
        T03: "ie_foreign_corporate_tax_rate",
        T04: "ie_prsi",
        T05: "ie_vat_rate",
        T06: "ie_customs_tariff_rate",
      } as const
    )[id as "T01" | "T02" | "T03" | "T04" | "T05" | "T06"],
    overseeingSeatId: treasurySeat.IE,
  },
  ...(["SCO", "WAL"] as const).map((country) => ({
    id,
    title,
    taxType,
    country,
    scope: "national" as const,
    existingLegislationTypeId: uk,
    overseeingSeatId: treasurySeat[country],
  })),
]);
nationalTaxes.push({
  id: "T07",
  title: "Local property tax",
  taxType: "propertyTax",
  country: "IE",
  scope: "national",
  existingLegislationTypeId: "ie_local_property_tax",
  overseeingSeatId: treasurySeat.IE,
});

const regionalTaxes: ResetTaxDefinition[] = [
  {
    id: "T01",
    title: "Income tax",
    taxType: "incomeTax",
    country: "US",
    scope: "regional",
    existingLegislationTypeId: "us_state_income_tax_rate",
    overseeingSeatId: null,
  },
  {
    id: "T02",
    title: "Domestic corporate tax",
    taxType: "domesticCorporateTax",
    country: "US",
    scope: "regional",
    existingLegislationTypeId: "us_state_domestic_corporate_tax_rate",
    overseeingSeatId: null,
  },
  {
    id: "T03",
    title: "Foreign corporate tax",
    taxType: "foreignCorporateTax",
    country: "US",
    scope: "regional",
    existingLegislationTypeId: "us_state_foreign_corporate_tax_rate",
    overseeingSeatId: null,
  },
  {
    id: "T05",
    title: "Sales tax",
    taxType: "salesTax",
    country: "US",
    scope: "regional",
    existingLegislationTypeId: "us_state_sales_tax_rate",
    overseeingSeatId: null,
  },
  {
    id: "T07",
    title: "Property tax",
    taxType: "propertyTax",
    country: "US",
    scope: "regional",
    existingLegislationTypeId: "us_state_property_tax_rate",
    overseeingSeatId: null,
  },
  {
    id: "T08",
    title: "Resident tax",
    taxType: "residentTax",
    country: "JP",
    scope: "regional",
    existingLegislationTypeId: "jp_resident_tax",
    overseeingSeatId: null,
  },
  {
    id: "T09",
    title: "Fixed-asset tax",
    taxType: "fixedAssetTax",
    country: "JP",
    scope: "regional",
    existingLegislationTypeId: "jp_fixed_asset_tax",
    overseeingSeatId: null,
  },
];

export const resetTaxes: readonly ResetTaxDefinition[] = [...nationalTaxes, ...regionalTaxes];

export function resetTaxesFor(
  country: ResetCountry,
  scope: TaxScope
): readonly ResetTaxDefinition[] {
  return resetTaxes.filter((tax) => tax.country === country && tax.scope === scope);
}
