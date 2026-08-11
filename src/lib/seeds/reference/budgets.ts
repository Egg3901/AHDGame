import { ObjectId } from "mongodb";
import { calculatePolicyOptionAnnualCost } from "@/lib/budget/costs";
import { computeTaxBaseGdpShareBaseline } from "@/lib/budget/revenue";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { EnactedLaw, FederalBudget, StateBudget } from "@/lib/db/types/budget";
import type { LegislationPolicyOption, LegislationType } from "@/lib/db/types/legislation";
import {
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { computeSectorImpliedUnits } from "@/lib/market/unownedHeadroom";
import {
  commandEconomySoeSectors,
  scheduledMarketizationLevel,
  COMMAND_CEILING,
} from "@/lib/constants/commandEconomy";
import { getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { makeSeedSoeState } from "@/lib/economy/soe";
import {
  COUNTRY_POLICY_CONFIGS,
  NATIONAL_DEFAULT_OPTION_INDEXES,
  NATIONAL_DEFAULTS,
  UK_NATIONAL_DEFAULT_OPTION_INDEXES,
  UK_NATIONAL_DEFAULTS,
} from "./basePolicies";
import { SEED_TAX_RATES_1953 } from "@/lib/politicalLegislation/seedTaxRates";
import { COUNTRY_POLICY_CONFIGS_1953 } from "./basePolicies1953";
import { COUNTRY_POLICY_CONFIGS_1979 } from "./basePolicies1979";
import { COUNTRY_POLICY_CONFIGS_1991 } from "./basePolicies1991";
import { COUNTRY_POLICY_CONFIGS_1999 } from "./basePolicies1999";
import { COUNTRY_POLICY_CONFIGS_2007 } from "./basePolicies2007";
import { COUNTRY_POLICY_CONFIGS_2023 } from "./basePolicies2023";
import { legislationTypes } from "./legislationTypes";
import { jpLegislationTypes } from "@/lib/seeds/jp/jpLegislationTypes";
import { deLegislationTypes } from "@/lib/seeds/de/deLegislationTypes";
import { ieLegislationTypes } from "@/lib/seeds/ie/ieLegislationTypes";
import { cnLegislationTypes } from "@/lib/seeds/cn/cnLegislationTypes";
import { ruLegislationTypes } from "@/lib/seeds/ru/ruLegislationTypes";
import { brLegislationTypes } from "@/lib/seeds/br/brLegislationTypes";
import { frLegislationTypes } from "@/lib/seeds/fr/frLegislationTypes";
import { itLegislationTypes } from "@/lib/seeds/it/itLegislationTypes";
import { esLegislationTypes } from "@/lib/seeds/es/esLegislationTypes";
import { seLegislationTypes } from "@/lib/seeds/se/seLegislationTypes";
import { trLegislationTypes } from "@/lib/seeds/tr/trLegislationTypes";
import { grLegislationTypes } from "../gr/grLegislationTypes";
import { atLegislationTypes } from "../at/atLegislationTypes";
import { fiLegislationTypes } from "../fi/fiLegislationTypes";
import { ddLegislationTypes } from "@/lib/seeds/dd/ddLegislationTypes";
import { huLegislationTypes } from "@/lib/seeds/hu/huLegislation";
import { plLegislationTypes } from "@/lib/seeds/pl/plLegislation";
import { roLegislationTypes } from "@/lib/seeds/ro/roLegislation";
import { yuLegislationTypes } from "@/lib/seeds/yu/yuLegislation";
import { bgLegislationTypes } from "@/lib/seeds/bg/bgLegislation";
import { blrLegislationTypes } from "@/lib/seeds/blr/blrLegislation";
import { csLegislationTypes } from "@/lib/seeds/cs/csLegislation";
import { balLegislationTypes } from "@/lib/seeds/bal/balLegislation";
import { easternBlocPolicyConfig } from "@/lib/seeds/shared/easternBlocLegislation";
import { deRegionalBudgetInputs } from "@/lib/seeds/de/deBudgets";
import { ieRegionalBudgetInputs } from "@/lib/seeds/ie/ieBudgets";
import { brRegionalBudgetInputs } from "@/lib/seeds/br/brBudgets";
import { cnRegionalBudgetInputs } from "@/lib/seeds/cn/cnBudgets";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode as ActiveCurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { LegalStructureId } from "@/lib/constants/legalStructures";
import {
  DE_PUBLIC_CORPORATION_OID,
  DE_PUBLIC_CEO_OID,
  DE_PUBLIC_USER_OID,
  DE_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/de/deCorporations";
import {
  IE_PUBLIC_CORPORATION_OID,
  IE_PUBLIC_CEO_OID,
  IE_PUBLIC_USER_OID,
  IE_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/ie/ieCorporations";
import {
  BR_PUBLIC_CORPORATION_OID,
  BR_PUBLIC_CEO_OID,
  BR_PUBLIC_USER_OID,
  BR_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/br/brCorporations";
import {
  CN_PUBLIC_CORPORATION_OID,
  CN_PUBLIC_CEO_OID,
  CN_PUBLIC_USER_OID,
  CN_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/cn/cnCorporations";
import {
  NG_PUBLIC_CORPORATION_OID,
  NG_PUBLIC_CEO_OID,
  NG_PUBLIC_USER_OID,
  NG_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/ng/ngCorporations";
import {
  DD_PUBLIC_CORPORATION_OID,
  DD_PUBLIC_CEO_OID,
  DD_PUBLIC_USER_OID,
  DD_PUBLIC_SEQUENTIAL_ID,
} from "@/lib/seeds/dd/ddCorporations";
import { getCountryConfig } from "@/lib/constants/countries";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";

/**
 * Default legal structure stamped on each country's sovereign issuer corporation.
 * Mirrors the per-country defaults from
 * `scripts/migrations/deprecated/2026-05-07-set-legal-structure-defaults.ts` — folded into
 * the seed so a fresh world doesn't depend on the backfill migration ever
 * running.
 */
const SOVEREIGN_CORP_LEGAL_STRUCTURE: Partial<Record<CountryId, LegalStructureId>> = {
  US: "us_c_corp",
  UK: "uk_plc",
  JP: "jp_kk",
  DE: "de_ag",
  IE: "ie_plc",
  BR: "br_sa_aberta",
  CN: "cn_gufen",
  NG: "ng_plc",
  // The USSR has no bespoke joint-stock legal form (Cold-War command economy);
  // the neutral fallback keeps corporationTurn able to process the RU state
  // enterprise. See GENERIC_LEGAL_STRUCTURE in constants/legalStructures.ts.
  RU: "generic_corp",
  // Same reasoning as RU: a planned economy has no bespoke joint-stock form.
  DD: "generic_corp",
  // Warsaw-Pact satellites (Command Economy v2 SOE stack, refs command-economy
  // seed-gap fix): none of these ran a bespoke joint-stock corporate form
  // either — same neutral fallback as RU/DD.
  PL: "generic_corp",
  HU: "generic_corp",
  CS: "generic_corp",
  BG: "generic_corp",
  UKR: "generic_corp",
  BLR: "generic_corp",
  BAL: "generic_corp",
  RO: "generic_corp",
  // Yugoslavia — command economy, no bespoke joint-stock form (see YU's SOE
  // note above on why it isn't grouped with the Warsaw-Pact five).
  YU: "generic_corp",
  // Econ-tier market democracies (corporate-sector seed-gap fix): promoted
  // from the abstract sphere-macro tier to full-autonomous (seedEconTierRosters
  // #3253, seedManifest.ts) with no bespoke joint-stock legal form authored yet
  // — same neutral fallback used for every other country here without one.
  FR: "generic_corp",
  IT: "generic_corp",
  ES: "generic_corp",
  SE: "generic_corp",
  TR: "generic_corp",
  GR: "generic_corp",
  AT: "generic_corp",
  FI: "generic_corp",
};

const budgetLegislationTypes = [
  ...legislationTypes,
  ...jpLegislationTypes,
  ...deLegislationTypes,
  ...ieLegislationTypes,
  ...cnLegislationTypes,
  ...ruLegislationTypes,
  ...brLegislationTypes,
  ...frLegislationTypes,
  ...itLegislationTypes,
  ...esLegislationTypes,
  ...seLegislationTypes,
  ...trLegislationTypes,
  ...grLegislationTypes,
  ...atLegislationTypes,
  ...fiLegislationTypes,
  ...ddLegislationTypes,
  ...huLegislationTypes,
  ...plLegislationTypes,
  ...roLegislationTypes,
  ...yuLegislationTypes,
  ...bgLegislationTypes,
  ...blrLegislationTypes,
  ...csLegislationTypes,
  ...balLegislationTypes,
];

type SupportedBudgetCountryId =
  | "US"
  | "UK"
  | "JP"
  | "DE"
  | "IE"
  | "BR"
  | "CN"
  | "NG"
  | "RU"
  | "FR"
  | "IT"
  | "ES"
  | "SE"
  | "TR"
  | "GR"
  | "AT"
  | "FI"
  | "DD"
  | "HU"
  | "PL"
  | "RO"
  | "YU"
  | "BG"
  | "BLR"
  | "UKR"
  | "CS"
  | "BAL";
type SupportedNationalBudget = Omit<FederalBudget, "updatedAt">;

interface NationalBudgetSeedConfig {
  budgetId: string;
  countryId: SupportedBudgetCountryId;
  fiscalYear: number;
  population: number;
  gdp: number;
  currencyCode:
    | "USD"
    | "GBP"
    | "JPY"
    | "EUR"
    | "IEP"
    | "BRL"
    | "CNY"
    | "NGN"
    | "SUR"
    | "FRF"
    | "ITL"
    | "ESP"
    | "SEK"
    | "TRL"
    | "GRD"
    | "ATS"
    | "FIM"
    | "DDM"
    | "HUF"
    | "PLZ"
    | "ROL"
    | "YUD"
    | "BGL"
    | "CSK";
  economicFactors: SupportedNationalBudget["economicFactors"];
  taxBaseRatios: {
    taxableIncome: number;
    /**
     * Total corporate-profits share of GDP. Split 75/25 into domestic/foreign during
     * budget construction. Kept as a single config field so existing tunings transfer
     * directly; consumers that need the split read `buildTaxBases()`.
     */
    corporateProfits: number;
    wagesAndSalaries: number;
    importValue: number;
    taxableSales: number;
  };
  otherRevenue: number;
  debt: SupportedNationalBudget["debt"];
  creditRating: SupportedNationalBudget["creditRating"];
  baselineSpendingByCategory: Record<string, number>;
  baselineStateGrants: number;
  policyRevenueConfigs?: Array<{
    legislationTypeId: string;
    revenueKey: keyof SupportedNationalBudget["revenue"];
    annualRevenuePerCapitaByOptionIndex?: number[];
    gdpRevenueMultiplierByOptionIndex?: number[];
  }>;
  policyDefaults: Record<string, { economic: number; social: number }>;
  policyOptionOverrides: Record<string, number>;
  /**
   * Political-legislation derivation switch (spec §4.2a): when set, the seeded
   * `federalBudget.taxRates` are written verbatim from this authored table
   * (SEED_TAX_RATES_1953[country]) and the legacy taxPolicyIds/option-index
   * derivation is skipped entirely. Set ONLY on the 1953 US/UK/RU/DD blocks —
   * their day-one rates come from the new tax-law catalog, whose baselineRate
   * values are validated equal to this same table.
   */
  seedTaxRatesOverride?: Record<string, number>;
  taxPolicyIds: {
    incomeTax: string;
    domesticCorporateTax: string;
    /**
     * Foreign corporate tax bill id. Wired in PR 1 but the actual bill is seeded in PR 2.
     * If absent, the foreign rate mirrors the domestic rate at seed time (day-one parity).
     */
    foreignCorporateTax?: string;
    payrollTax: string;
    tariffs?: string;
    salesTax: string;
    /**
     * DE-only Solidaritätszuschlag bill id. When set, the seeded FederalBudget.taxRates
     * picks up the default rate via `deriveTaxRates`. Non-DE countries omit.
     */
    solidaritySurcharge?: string;
    /**
     * CN-only Land Value-Added Tax (土地增值税) bill id. Optional — non-CN countries omit.
     * Added 2026-05-27 with the CN legislation overhaul (PR1).
     */
    landValueAddedTax?: string;
    /**
     * CN-only Urban Maintenance & Construction Tax (城市维护建设税) bill id. Optional —
     * non-CN countries omit. Added 2026-05-27 with the CN legislation overhaul (PR1).
     */
    urbanMaintenanceTax?: string;
    /**
     * CN-only Stamp Duty (印花税) bill id. Optional — non-CN countries omit.
     * Added 2026-05-27 with the CN legislation overhaul (PR1).
     */
    stampDuty?: string;
    /**
     * Property tax bill id. Optional — countries with a propertyTax dial set
     * this to their property-tax legislation type (IE: ie_local_property_tax).
     */
    propertyTax?: string;
    /**
     * IE-only Universal Social Charge bill id. Optional — non-IE countries omit.
     * Added 2026-05-27 with the IE legislation overhaul (PR1).
     */
    universalSocialCharge?: string;
    /**
     * IE-only Capital Gains Tax bill id. Optional — non-IE countries omit.
     * Added 2026-05-27 with the IE legislation overhaul (PR1).
     */
    capitalGainsTax?: string;
    /**
     * IE-only Excise Duty bill id. Optional — non-IE countries omit.
     * Added 2026-05-27 with the IE legislation overhaul (PR1).
     */
    exciseDuty?: string;
  };
  /**
   * Direct tax-rate overrides (percentages) for dials not yet backed by seeded
   * legislation types. Merged last in `deriveTaxRates`, so they win over both the
   * legislation lookup and the foreign-corporate mirror. Stopgap for countries
   * with no tax-legislation module yet (cf. BR, whose taxPolicyIds reference
   * legislation-type ids that are defined nowhere → every rate would seed to 0,
   * i.e. permanent zero-revenue). Keys are FederalTaxRates fields.
   */
  taxRateOverrides?: Partial<SupportedNationalBudget["taxRates"]>;
}

function findMatchedOption(
  options: LegislationPolicyOption[] | undefined,
  economic: number,
  social: number
): LegislationPolicyOption | undefined {
  if (!options?.length) return undefined;

  const exact = options.find((option) => option.economic === economic && option.social === social);
  if (exact) return exact;

  let best: LegislationPolicyOption | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const option of options) {
    const distance =
      Math.abs((option.economic ?? 0) - economic) + Math.abs((option.social ?? 0) - social);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }

  return best;
}

function buildTaxBases(config: NationalBudgetSeedConfig): SupportedNationalBudget["taxBases"] {
  // Split the total corporate-profits share 75/25 into domestic/foreign. This is the
  // bootstrap ratio per the migration spec; per-turn simulation overwrites both fields
  // with actual accumulated corp income.
  const totalCorporateProfits = config.gdp * config.taxBaseRatios.corporateProfits;
  return {
    taxableIncome: config.gdp * config.taxBaseRatios.taxableIncome,
    domesticCorporateProfits: totalCorporateProfits * 0.75,
    foreignCorporateProfits: totalCorporateProfits * 0.25,
    wagesAndSalaries: config.gdp * config.taxBaseRatios.wagesAndSalaries,
    importValue: config.gdp * config.taxBaseRatios.importValue,
    taxableSales: config.gdp * config.taxBaseRatios.taxableSales,
  };
}

function getPolicyDefaults(config: NationalBudgetSeedConfig, legislationTypeId: string) {
  return config.policyDefaults[legislationTypeId] ?? { economic: 0, social: 0 };
}

function getDefaultPolicyOption(
  config: NationalBudgetSeedConfig,
  legislationType: LegislationType
): LegislationPolicyOption | undefined {
  const overrideIndex = config.policyOptionOverrides[legislationType._id];
  if (overrideIndex !== undefined) {
    return legislationType.policyOptions?.[overrideIndex];
  }

  const defaults = getPolicyDefaults(config, legislationType._id);
  return findMatchedOption(legislationType.policyOptions, defaults.economic, defaults.social);
}

function deriveTaxRates(
  config: NationalBudgetSeedConfig,
  typesById: Map<string, LegislationType>
): SupportedNationalBudget["taxRates"] {
  const taxRates: SupportedNationalBudget["taxRates"] = {
    incomeTax: 0,
    domesticCorporateTax: 0,
    foreignCorporateTax: 0,
    payrollTax: 0,
    tariffs: 0,
    salesTax: 0,
  };

  // Spec §4.2a: authored-table override — the full six-key rate set verbatim,
  // no option-index derivation. See NationalBudgetSeedConfig.seedTaxRatesOverride.
  if (config.seedTaxRatesOverride) {
    return { ...taxRates, ...config.seedTaxRatesOverride };
  }

  for (const [taxType, legislationTypeId] of Object.entries(config.taxPolicyIds)) {
    if (!legislationTypeId) continue;
    const legislationType = typesById.get(legislationTypeId);
    const defaultOption = legislationType
      ? getDefaultPolicyOption(config, legislationType)
      : undefined;
    const rate = defaultOption?.rate;
    if (rate !== undefined) {
      (taxRates as unknown as Record<string, number>)[taxType] = rate;
    }
  }

  // Day-one parity: if foreign bill is not yet seeded (PR 1 state), mirror the domestic rate.
  // PR 2 will populate taxPolicyIds.foreignCorporateTax and this branch becomes a no-op.
  if (!config.taxPolicyIds.foreignCorporateTax) {
    taxRates.foreignCorporateTax = taxRates.domesticCorporateTax;
  }

  // Direct overrides for dials whose taxPolicyIds reference unseeded legislation
  // types (deriveTaxRates would otherwise leave them at 0). Applied last so they
  // are authoritative over the legislation lookup and the foreign-mirror fallback.
  if (config.taxRateOverrides) {
    for (const [taxType, rate] of Object.entries(config.taxRateOverrides)) {
      if (typeof rate === "number" && Number.isFinite(rate)) {
        (taxRates as unknown as Record<string, number>)[taxType] = rate;
      }
    }
  }

  return taxRates;
}

function derivePolicyRevenueLines(
  config: NationalBudgetSeedConfig,
  typesById: Map<string, LegislationType>
): Partial<SupportedNationalBudget["revenue"]> {
  const revenueLines: Partial<SupportedNationalBudget["revenue"]> = {};

  for (const revenueConfig of config.policyRevenueConfigs ?? []) {
    const legislationType = typesById.get(revenueConfig.legislationTypeId);
    if (!legislationType?.policyOptions?.length) continue;

    const defaultOption = getDefaultPolicyOption(config, legislationType);
    if (!defaultOption) continue;

    const optionIndex = legislationType.policyOptions.findIndex(
      (option) => option.id === defaultOption.id
    );
    if (optionIndex < 0) continue;

    const revenueFromPopulation = revenueConfig.annualRevenuePerCapitaByOptionIndex?.[optionIndex];
    const revenueFromGdp = revenueConfig.gdpRevenueMultiplierByOptionIndex?.[optionIndex];

    let annualRevenue = 0;
    if (revenueFromPopulation !== undefined) {
      annualRevenue += revenueFromPopulation * config.population;
    }
    if (revenueFromGdp !== undefined) {
      annualRevenue += revenueFromGdp * config.gdp;
    }
    if (annualRevenue === 0) continue;

    revenueLines[revenueConfig.revenueKey] = Math.round(annualRevenue);
  }

  return revenueLines;
}

/**
 * Old-catalog country scopes owned by political-legislation v2. Shared with the
 * seeders so the list cannot drift — it applies at every preset now that the
 * pipeline is year-driven rather than 1953-gated.
 */
import { POLITICAL_LEGISLATION_EXCLUDED_SCOPES as POLITICAL_LEGISLATION_OLD_SCOPES } from "@/lib/politicalMetrics/pipelinePreset";

/**
 * Authored historical fiscal baselines for 1953 (Korean War defense shares,
 * pre-Medicare healthcare, occupation-cost DE defense, etc.). The modern
 * legislation catalog's absolute per-capita costs, even after GDP-indexed
 * scaling, preserve peacetime 1991 *composition* — e.g. US defense ≈2% GDP
 * instead of the authored ~14%.
 *
 * Political-legislation countries (US/UK/RU/DD) use the full authored table
 * (v2 sync overwrites day-one anyway). Other 1953 countries only override the
 * historically-sensitive defense/healthcare categories so command-economy /
 * developing-country baselines don't invent structural 30–40% GDP deficits
 * against revenue still derived from the modern tax dials.
 */
const BASELINE_OVERRIDE_CATEGORIES = ["defense", "healthcare", "health"] as const;

/**
 * Per-country extensions to {@link BASELINE_OVERRIDE_CATEGORIES}: categories
 * whose authored 1953 baseline is historically load-bearing enough to pin
 * exactly like defense/healthcare, beyond the shared defaults. Added
 * surgically per country (never to the shared list) so widening one
 * country's coverage can't perturb another's already-tuned 1953 balance.
 *
 * CN: "infrastructure" is the First-Five-Year-Plan's defining category (Soviet
 * -assisted heavy industry, the 156 key projects) — the single biggest line in
 * CN's authored baseline, previously priced entirely off the modern per-domain
 * era catalog (calibrated for 2023 CN's marginal infrastructure policy, not a
 * command economy's total investment programme), which is why fiscal audit
 * F-11 found CN spending collapsed to under 10% of GDP.
 *
 * JP: "infrastructure" (the authored key was "publicWorks" — see the 1953 JP
 * config rename below — a name mismatch that made the reconstruction-
 * infrastructure line invisible to both this override AND
 * `resolveInfraEnvelope`'s `baselineSpendingByCategory.infrastructure` read).
 * "social" similarly replaces the authored "socialSecurity" key, which never
 * matched any JP legislation type's actual `budgetCategory` ("social").
 *
 * DE: "welfare" and "transport" — same class of bug as JP's rename, found
 * while auditing DE's +13.1%-of-GDP day-26 surplus (fiscal-scale audit,
 * 2026-07-28). DE's authored 1953 baseline (see the DE 1953 config below) used
 * "socialSecurity" and "infrastructure", but none of `deLegislationTypes.ts`'s
 * ~40 budgetCategory-bearing laws use those literal strings — DE's Bismarckian
 * pensions/unemployment-insurance laws are categorized "welfare" and its
 * Wirtschaftswunder rail/reconstruction law ("Federal Rail Transport Act") is
 * categorized "transport". The baseline keys below are renamed to match, and
 * both — plus "education" and "other", whose modern-catalog policy costs
 * likewise undershot the authored 1953 figures — are pinned here. Real West
 * German 1953 government spending ran ~30% of GDP (high-tax, high-transfer
 * Adenauer-era Sozialstaat, occupation costs, and Kriegsopferversorgung
 * war-victim pensions); the full authored baseline (14+6+3+3+8+9 = 43B DEM,
 * ≈31.2% GDP before state grants) lands in that range, which the previous
 * partial pin (defense/healthcare only) never reached.
 *
 * BR: "socialSecurity", "infrastructure", "education", "other" — Brazil's
 * legislation module (brLegislationTypes.ts) authors exactly one spending law
 * per budget category (plus a grant law, see GRANT_OVERRIDE_COUNTRIES), so
 * pinning every category (not just defense/healthcare) makes the day-1 seed
 * reproduce the authored 1953 baseline exactly rather than whatever the
 * per-capita ladder's default option happens to compute.
 *
 * AT/FI/FR/GR/IT/SE/TR: "socialSecurity", "education", "infrastructure",
 * "other" — the seven market-democracy 1953 seeds previously fell back to
 * `baselineSpendingByCategory` wholesale (their sole legislation type touching
 * the budget was the welfare-state law, and it carried no cost — see the
 * legislationCostCatalog.ts header). Each now authors one `gdpPerCapitaMultiplier`-
 * costed spending law per category (fiscal-scale audit, 2026-07-28): the
 * welfare-state law for socialSecurity, plus new health/education/
 * infrastructure/defense/other/grant laws. Pinning the four non-defense/
 * non-healthcare categories here is the same safety net DE/BR use — the
 * per-country ladders are calibrated to reconcile exactly already, so this
 * only guards against rounding drift in the seed snapshot, not the runtime
 * per-turn cost (which reads the authored `gdpPerCapitaMultiplier` directly).
 */
const EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY: Partial<Record<string, readonly string[]>> = {
  CN: ["infrastructure"],
  JP: ["infrastructure", "social"],
  DE: ["welfare", "transport", "education", "other"],
  BR: ["socialSecurity", "infrastructure", "education", "other"],
  AT: ["socialSecurity", "education", "infrastructure", "other"],
  FI: ["socialSecurity", "education", "infrastructure", "other"],
  FR: ["socialSecurity", "education", "infrastructure", "other"],
  GR: ["socialSecurity", "education", "infrastructure", "other"],
  IT: ["socialSecurity", "education", "infrastructure", "other"],
  SE: ["socialSecurity", "education", "infrastructure", "other"],
  TR: ["socialSecurity", "education", "infrastructure", "other"],
};

/**
 * Countries whose sole `isGrant` 1953 law should be rescaled to the authored
 * `baselineStateGrants` figure, mirroring the category rescale below. JP's
 * Local Allocation Tax Act (地方交付税) is a real, large equalization-grant
 * mechanism (authored at ¥1.11B ≈ 4.3% of GDP) that was booking only its thin
 * modern-era-catalog gdpCostFraction share (≈0.1% of GDP) — the `spending.ts`
 * `CONFIG_DERIVED_TRANSFER_FIELD` comment's claim that "JP's isGrant funding
 * laws already book the grant" was true only in the sense that a law existed,
 * not that it booked the authored amount. CN's central-transfer pool is
 * handled separately via `CONFIG_DERIVED_TRANSFER_FIELD` (regional-processor
 * config, not an enacted law) and does not need this treatment.
 */
// BR's sole `isGrant` law (Auxílios aos Estados Act, brLegislationTypes.ts) gets
// the same treatment so its booked cost matches the authored
// `baselineStateGrants` (~3% of GDP) exactly rather than its per-capita
// ladder's raw default.
// AT/FI/FR/GR/IT/SE/TR each authored a new `isGrant` local-government transfer
// law (at_local_grants et al., fiscal-scale audit 2026-07-28) — same treatment
// so it reconciles to `baselineStateGrants` exactly.
const GRANT_OVERRIDE_COUNTRIES = new Set(["JP", "BR", "AT", "FI", "FR", "GR", "IT", "SE", "TR"]);

function overrideCategoriesFor(countryId: string): Set<string> {
  const extra = EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY[countryId.toUpperCase()] ?? [];
  return new Set<string>([...BASELINE_OVERRIDE_CATEGORIES, ...extra]);
}

function isPoliticalLegislationCountry(countryId: string): boolean {
  return POLITICAL_LEGISLATION_OLD_SCOPES.has(countryId.toLowerCase());
}

function preferFullAuthoredBaseline(config: NationalBudgetSeedConfig): boolean {
  return config.fiscalYear === 1953 && isPoliticalLegislationCountry(config.countryId);
}

function preferCategoryBaselineOverrides(config: NationalBudgetSeedConfig): boolean {
  return config.fiscalYear === 1953 && !isPoliticalLegislationCountry(config.countryId);
}

function deriveSpending(
  config: NationalBudgetSeedConfig,
  typesById: Map<string, LegislationType>
): SupportedNationalBudget["spending"] {
  // US/UK/RU/DD on 1953: full authored baselines (political-legislation sync
  // replaces these with the v2 law book shortly after seed).
  if (preferFullAuthoredBaseline(config)) {
    const byCategory: Record<string, number> = {};
    for (const [category, amount] of Object.entries(config.baselineSpendingByCategory)) {
      byCategory[category] = Math.max(0, Math.round(amount));
    }
    const debtInterest = Math.round(config.debt.principal * config.debt.interestRate);
    const categoryTotal = Object.values(byCategory).reduce((sum, amount) => sum + amount, 0);
    const stateGrants = config.baselineStateGrants;
    return {
      byCategory,
      stateGrants,
      debtInterest,
      total: categoryTotal + stateGrants + debtInterest,
    };
  }

  const policyByCategory: Record<string, number> = {};
  let policyStateGrants = 0;
  let hasPolicySpending = false;

  for (const legislationType of typesById.values()) {
    if (legislationType.countryScope !== config.countryId.toLowerCase()) continue;
    if (!legislationType.budgetCategory) continue;
    if (legislationType.allowedScope === "state") continue;

    const defaultOption = getDefaultPolicyOption(config, legislationType);
    const annualCost = calculatePolicyOptionAnnualCost(defaultOption, {
      budgetCapacity: 0,
      gdp: config.gdp,
      population: config.population,
      countryId: config.countryId,
      nationalGdpPerCapita: config.population > 0 ? config.gdp / config.population : undefined,
    });
    if (annualCost === undefined) continue;

    hasPolicySpending = true;
    if (legislationType.isGrant) {
      policyStateGrants += annualCost;
    } else {
      policyByCategory[legislationType.budgetCategory] =
        (policyByCategory[legislationType.budgetCategory] ?? 0) + annualCost;
    }
  }

  const byCategory = hasPolicySpending
    ? policyByCategory
    : { ...config.baselineSpendingByCategory };

  // DE/JP/IE/CN/…: pin defense + healthcare (plus any per-country extras, see
  // EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY) to authored 1953 shares so the
  // modern per-capita ladder can't underweight Cold War defense or overweight
  // pre-welfare-state healthcare — without replacing the whole spend table.
  if (preferCategoryBaselineOverrides(config) && hasPolicySpending) {
    for (const key of overrideCategoriesFor(config.countryId)) {
      const authored = config.baselineSpendingByCategory[key];
      if (authored !== undefined) {
        byCategory[key] = authored;
      }
    }
  }

  for (const [category, amount] of Object.entries(byCategory)) {
    byCategory[category] = Math.max(0, Math.round(amount));
  }

  const debtInterest = Math.round(config.debt.principal * config.debt.interestRate);
  const categoryTotal = Object.values(byCategory).reduce((sum, amount) => sum + amount, 0);
  const stateGrants = hasPolicySpending
    ? Math.max(0, Math.round(policyStateGrants))
    : config.baselineStateGrants;

  return {
    byCategory,
    stateGrants,
    debtInterest,
    total: categoryTotal + stateGrants + debtInterest,
  };
}

/**
 * Sovereign-default / IMF defaults stamped on every freshly-seeded national
 * budget. Mirrors the explicit zero-fill the
 * `sovereignDefaultPhase1FederalBudget.ts` migration applies to legacy budgets
 * — folded into the seed so a brand-new game doesn't depend on that migration
 * ever running. See `docs/reset-and-seed-contract.md`.
 */
function sovereignDefaultBudgetFields(): Pick<
  SupportedNationalBudget,
  | "sovereignCrisisState"
  | "failedAuctionConsecutiveCount"
  | "lastAuctionDemandRatio"
  | "crisisFiredAt"
  | "crisisChoice"
  | "crisisChoiceAt"
  | "crisisLegislativeProposalId"
  | "crisisAutoActionAt"
  | "crisisLegislativeDeadlineAt"
  | "recoveryStartedAt"
  | "recoveryFiscalDisciplineStreak"
  | "marketAccessLockedUntilTurn"
  | "lastDefaultTurn"
  | "recoveryGdpPenaltyPercent"
  | "recoveryGdpPenaltyTurnsRemaining"
  | "recoveryCredibilityBonusUntilTurn"
  | "imfSovereignBailoutActive"
  | "imfSovereignFacilityPrincipalOutstanding"
  | "imfSovereignFacilityAnnualRate"
  | "imfSovereignFacilityAmortizationTurnsRemaining"
  | "imfSovereignFacilityIncomeCaptureFraction"
  | "imfSovereignFacilityImfCorporationId"
  | "imfSovereignFacilityCumulativePaidAnchor"
  | "imfBoardOverrideWindowEndAt"
  | "imfBoardOverrideAt"
  | "imfBoardOverrideBy"
  | "imfBoardOverrideKind"
  | "imfBoardOverrideRateDelta"
  | "imfBoardOverrideCaptureDelta"
  | "imfBoardPublicStatement"
> {
  return {
    // State machine — every fresh budget starts in "normal".
    sovereignCrisisState: "normal",

    // Auction tracking
    failedAuctionConsecutiveCount: 0,
    lastAuctionDemandRatio: 1.0,

    // Crisis lifecycle — no active crisis.
    crisisFiredAt: null,
    crisisChoice: null,
    crisisChoiceAt: null,
    crisisLegislativeProposalId: null,
    crisisAutoActionAt: null,
    crisisLegislativeDeadlineAt: null,

    // Recovery state — no recovery in progress.
    recoveryStartedAt: null,
    recoveryFiscalDisciplineStreak: 0,
    marketAccessLockedUntilTurn: null,
    lastDefaultTurn: null,
    recoveryGdpPenaltyPercent: null,
    recoveryGdpPenaltyTurnsRemaining: null,
    recoveryCredibilityBonusUntilTurn: null,

    // IMF facility — inactive.
    imfSovereignBailoutActive: false,
    imfSovereignFacilityPrincipalOutstanding: 0,
    imfSovereignFacilityAnnualRate: 0,
    imfSovereignFacilityAmortizationTurnsRemaining: 0,
    imfSovereignFacilityIncomeCaptureFraction: 0,
    imfSovereignFacilityImfCorporationId: null,
    imfSovereignFacilityCumulativePaidAnchor: 0,

    // IMF board override window — closed.
    imfBoardOverrideWindowEndAt: null,
    imfBoardOverrideAt: null,
    imfBoardOverrideBy: null,
    imfBoardOverrideKind: null,
    imfBoardOverrideRateDelta: null,
    imfBoardOverrideCaptureDelta: null,
    imfBoardPublicStatement: null,
  };
}

function buildNationalBudgetSeed(config: NationalBudgetSeedConfig): SupportedNationalBudget {
  const taxBases = buildTaxBases(config);
  const typesById = new Map(
    budgetLegislationTypes.map((legislationType) => [legislationType._id, legislationType] as const)
  );
  const taxRates = deriveTaxRates(config, typesById);
  const policyRevenueLines = derivePolicyRevenueLines(config, typesById);

  // DE Solidaritätszuschlag — surcharge on income tax revenue, not on income base.
  // Stored on taxRates as a plain percentage. Non-DE presets leave it undefined → 0.
  const incomeTax = Math.round(taxBases.taxableIncome * (taxRates.incomeTax / 100));
  const solidaritySurcharge = Math.round(incomeTax * ((taxRates.solidaritySurcharge ?? 0) / 100));
  const salesTax = Math.round(taxBases.taxableSales * (taxRates.salesTax / 100));
  // CN LVAT (土地增值税) — 5% of domesticCorporateProfits as real-estate-sector proxy.
  // CN UMCT (城市维护建设税) — surcharge on salesTax (VAT) revenue.
  // CN Stamp Duty (印花税) — 2% of GDP as documented-transactions proxy.
  // All three: non-CN presets leave the rate undefined → 0.
  const lvatBase = taxBases.domesticCorporateProfits * 0.05;
  const landValueAddedTax = Math.round(lvatBase * ((taxRates.landValueAddedTax ?? 0) / 100));
  const urbanMaintenanceTax = Math.round(salesTax * ((taxRates.urbanMaintenanceTax ?? 0) / 100));
  const stampDutyBase = config.gdp * 0.02;
  const stampDuty = Math.round(stampDutyBase * ((taxRates.stampDuty ?? 0) / 100));
  // IE-specific seed revenue lines — match calculateFederalRevenue computation so
  // the seed budget's revenue.total reflects the same yield the runtime produces.
  // Non-IE presets leave the rate undefined → 0.
  const universalSocialCharge = Math.round(
    taxBases.wagesAndSalaries * ((taxRates.universalSocialCharge ?? 0) / 100)
  );
  const capitalGainsBase = config.gdp * 0.03;
  const capitalGainsTax = Math.round(capitalGainsBase * ((taxRates.capitalGainsTax ?? 0) / 100));
  const exciseableBase = config.gdp * 0.015;
  const exciseDuty = Math.round(exciseableBase * ((taxRates.exciseDuty ?? 0) / 100));
  const propertyValueBase = config.gdp * 0.5;
  const propertyTax = Math.round(propertyValueBase * ((taxRates.propertyTax ?? 0) / 100));
  const revenue = {
    incomeTax,
    domesticCorporateTax: Math.round(
      taxBases.domesticCorporateProfits * (taxRates.domesticCorporateTax / 100)
    ),
    foreignCorporateTax: Math.round(
      taxBases.foreignCorporateProfits * (taxRates.foreignCorporateTax / 100)
    ),
    payrollTax: Math.round(taxBases.wagesAndSalaries * (taxRates.payrollTax / 100)),
    tariffs: Math.round(taxBases.importValue * (taxRates.tariffs / 100)),
    salesTax,
    solidaritySurcharge,
    landValueAddedTax,
    urbanMaintenanceTax,
    stampDuty,
    universalSocialCharge,
    capitalGainsTax,
    exciseDuty,
    propertyTax,
    healthcareIncome: 0,
    other: config.otherRevenue,
    total: 0,
    ...policyRevenueLines,
  };
  revenue.total =
    revenue.incomeTax +
    revenue.domesticCorporateTax +
    revenue.foreignCorporateTax +
    revenue.payrollTax +
    revenue.tariffs +
    revenue.salesTax +
    revenue.solidaritySurcharge +
    revenue.landValueAddedTax +
    revenue.urbanMaintenanceTax +
    revenue.stampDuty +
    revenue.universalSocialCharge +
    revenue.capitalGainsTax +
    revenue.exciseDuty +
    revenue.propertyTax +
    revenue.healthcareIncome +
    revenue.other;

  const spending = deriveSpending(config, typesById);
  const surplus = revenue.total - spending.total;

  return {
    _id: config.budgetId,
    countryId: config.countryId,
    fiscalYear: config.fiscalYear,
    revenue,
    taxRates,
    taxBases,
    // Capture each base's authored/seeded share of GDP *at seed time* - before
    // any turn runs - as the permanent per-country target the fiscal-divergence
    // guardrail (`taxBaseGdpShareBaseline`, see budget.ts) tracks toward, and
    // that `updateCorporateTaxBases`'s per-turn floor blends against instead of
    // a single universal modern-mixed-economy constant (fiscal-scale audit,
    // 2026-07-29: a command economy's authored corporate/enterprise-surplus
    // base sits far above that constant; seeding this here - rather than
    // relying on fiscalBaseGrowth's deferred self-heal, which can run AFTER the
    // corp-turn phase has already overwritten taxBases for the turn - stops the
    // baseline from ever being captured off an already-corrupted value).
    taxBaseGdpShareBaseline: computeTaxBaseGdpShareBaseline(taxBases, config.gdp),
    economicFactors: config.economicFactors,
    spending,
    debt: config.debt,
    // Signed cash position seeds to the country's current fiscal debt: a country
    // with debt starts negative, a debt-free country starts at 0. Mirrors the
    // one-time backfill migration so seed and migration agree.
    treasuryBalance: -(config.debt.principal ?? 0),
    surplus,
    gdp: config.gdp,
    debtToGdpRatio: config.debt.principal / config.gdp,
    creditRating: config.creditRating,
    sovereignRiskAnchor: {
      debtToGdpRatio: config.debt.principal / config.gdp,
      creditRating: config.creditRating,
      interestRate: config.debt.interestRate,
    },
    currencyCode: config.currencyCode,
    baselineSpendingByCategory: config.baselineSpendingByCategory,
    baselineStateGrants: config.baselineStateGrants,
    ...sovereignDefaultBudgetFields(),
  };
}

// Deterministic ObjectId for seeded enacted laws so re-seeding is idempotent.
const SEED_BILL_ID = new ObjectId("600000000000000000000001");

export interface SeedEnactedLaw {
  legislationTypeId: string;
  title: string;
  scope: "national";
  countryId: string;
  budgetCost: number;
  gdpPerCapitaMultiplier?: number;
  annualCostPerCapita?: number;
  annualCostUsd?: number;
  gdpCostFraction?: number;
  incomeCostFraction?: number;
  rate?: number;
  policyOptionIndex?: number;
  isGrant?: boolean;
  budgetCategory: string;
  enactedYear: number;
}

function deriveEnactedLaws(
  config: NationalBudgetSeedConfig,
  /**
   * Year the policy vacuum keys on. Defaults to the config's own fiscal year
   * (correct for historical presets, where every config's fiscalYear equals the
   * preset start year). The default/modern preset passes the preset's canonical
   * year instead, because its per-country configs carry mixed snapshot years
   * (US 2020, CN 2023) — without this, a "2019-default" world would seed a
   * cn_common_prosperity (2021) law off CN's 2023 config.
   */
  vacuumYear: number = config.fiscalYear
): SeedEnactedLaw[] {
  // Political-legislation v2 owns US/UK/RU/DD on the 1953 preset — seeding the
  // old modern-template catalogs here would leave orphan annualCostPerCapita
  // laws that calculateFederalSpending still prices alongside the v2 book.
  if (vacuumYear === 1953 && POLITICAL_LEGISLATION_OLD_SCOPES.has(config.countryId.toLowerCase())) {
    return [];
  }

  const typesById = new Map(budgetLegislationTypes.map((lt) => [lt._id, lt] as const));
  const laws: SeedEnactedLaw[] = [];
  /** Raw policy-derived costs for 1953 baseline rescaling (spending laws only). */
  const rawCosts: number[] = [];

  for (const legislationType of typesById.values()) {
    if (legislationType.countryScope !== config.countryId.toLowerCase()) continue;
    if (legislationType.allowedScope === "state") continue;

    // Policy vacuum: an old-era preset boots with no statute for a domain that
    // does not exist yet. Keyed on the preset year, NOT the toggle — a 1991 world
    // carrying a broadband statute is a seed defect regardless.
    if (!isLegislationTypeActive(legislationType._id, vacuumYear)) continue;

    const defaultOption = getDefaultPolicyOption(config, legislationType);
    if (!defaultOption) continue;

    const isTaxRate = defaultOption.rate !== undefined;

    // Tax rate types don't have budgetCategory — they contribute revenue, not spending.
    // Non-tax types must have a budgetCategory to be included.
    if (!isTaxRate && !legislationType.budgetCategory) continue;

    const annualCost = isTaxRate
      ? undefined
      : calculatePolicyOptionAnnualCost(defaultOption, {
          budgetCapacity: 0,
          gdp: config.gdp,
          population: config.population,
          countryId: config.countryId,
          nationalGdpPerCapita: config.population > 0 ? config.gdp / config.population : undefined,
        });

    // Include both spending laws (annualCost defined) and tax rate laws (rate defined)
    if (annualCost === undefined && !isTaxRate) continue;

    const optionIndex = legislationType.policyOptions?.indexOf(defaultOption);

    if (!isTaxRate) {
      rawCosts.push(annualCost!);
    }

    laws.push({
      legislationTypeId: legislationType._id,
      title: `${legislationType.name} (Default)`,
      scope: "national",
      countryId: config.countryId,
      budgetCost: legislationType.budgetCost || 0,
      ...(defaultOption.gdpPerCapitaMultiplier !== undefined && {
        gdpPerCapitaMultiplier: defaultOption.gdpPerCapitaMultiplier,
      }),
      ...(defaultOption.annualCostPerCapita !== undefined && {
        annualCostPerCapita: defaultOption.annualCostPerCapita,
      }),
      ...(defaultOption.gdpCostFraction !== undefined && {
        gdpCostFraction: defaultOption.gdpCostFraction,
      }),
      ...(defaultOption.incomeCostFraction !== undefined && {
        incomeCostFraction: defaultOption.incomeCostFraction,
      }),
      ...(isTaxRate && { rate: defaultOption.rate }),
      ...(optionIndex !== undefined && optionIndex >= 0 && { policyOptionIndex: optionIndex }),
      budgetCategory: legislationType.budgetCategory || legislationType.policyDomain || "tax",
      enactedYear: config.fiscalYear,
      ...(legislationType.isGrant ? { isGrant: true } : {}),
    });
  }

  // 1953: rewrite spending-law cost fields for historically-sensitive categories
  // so runtime calculateFederalSpending reproduces authored defense/healthcare
  // (plus per-country extras, see EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY) shares.
  // gdpPerCapitaMultiplier × gdp is the legacy GDP-share form and is not
  // re-scaled by getGdpIndexedCostScale. Political countries seed no old laws
  // (above). Other countries only rescale defense/healthcare by default.
  if (preferCategoryBaselineOverrides(config) && config.gdp > 0) {
    const overrideCats = overrideCategoriesFor(config.countryId);
    const spendingIdx: number[] = [];
    for (let i = 0; i < laws.length; i++) {
      if (laws[i].rate === undefined) spendingIdx.push(i);
    }
    const byCategoryRaw = new Map<string, { lawPos: number; raw: number }[]>();
    const grantEntries: { lawPos: number; raw: number }[] = [];
    for (let j = 0; j < spendingIdx.length; j++) {
      const lawPos = spendingIdx[j]!;
      const law = laws[lawPos]!;
      const raw = rawCosts[j] ?? 0;
      if (law.isGrant) {
        if (GRANT_OVERRIDE_COUNTRIES.has(config.countryId.toUpperCase())) {
          grantEntries.push({ lawPos, raw });
        }
        continue;
      }
      if (!overrideCats.has(law.budgetCategory)) continue;
      const list = byCategoryRaw.get(law.budgetCategory) ?? [];
      list.push({ lawPos, raw });
      byCategoryRaw.set(law.budgetCategory, list);
    }

    // Rescale the country's isGrant law(s) to the authored baselineStateGrants
    // total the same way categories are rescaled below (see
    // GRANT_OVERRIDE_COUNTRIES — currently JP's Local Allocation Tax Act).
    if (grantEntries.length > 0) {
      const rawGrantSum = grantEntries.reduce((s, e) => s + Math.max(0, e.raw), 0);
      const grantTarget = config.baselineStateGrants;
      for (const { lawPos, raw } of grantEntries) {
        const share = rawGrantSum > 0 ? Math.max(0, raw) / rawGrantSum : 1 / grantEntries.length;
        const scaled = grantTarget * share;
        const law = laws[lawPos]!;
        delete law.annualCostPerCapita;
        delete law.gdpCostFraction;
        delete law.incomeCostFraction;
        law.gdpPerCapitaMultiplier = scaled / config.gdp;
      }
    }

    for (const [cat, entries] of byCategoryRaw) {
      const rawSum = entries.reduce((s, e) => s + Math.max(0, e.raw), 0);
      const target = config.baselineSpendingByCategory[cat] ?? rawSum;
      for (const { lawPos, raw } of entries) {
        const share = rawSum > 0 ? Math.max(0, raw) / rawSum : 1 / entries.length;
        const scaled = target * share;
        const law = laws[lawPos]!;
        delete law.annualCostPerCapita;
        delete law.gdpCostFraction;
        delete law.incomeCostFraction;
        law.gdpPerCapitaMultiplier = scaled / config.gdp;
      }
    }
  }

  return laws;
}

export function generateDefaultEnactedLaws(
  preset: string
): Array<Omit<EnactedLaw, "_id"> & { _id: ObjectId }> {
  const now = new Date();
  const laws: Array<Omit<EnactedLaw, "_id"> & { _id: ObjectId }> = [];
  const configs = getNationalBudgetSeedConfigsForPreset(preset);
  // Preset canonical year for the policy vacuum: the leading 4 digits of the
  // preset id ("1991-default" → 1991), falling back to 2019 for the modern
  // default. Overrides each config's own fiscalYear, which for the default
  // preset carries mixed per-country snapshot years.
  const parsedPresetYear = parseInt(preset.slice(0, 4), 10);
  const vacuumYear = Number.isFinite(parsedPresetYear) ? parsedPresetYear : 2019;

  for (const config of configs) {
    for (const seed of deriveEnactedLaws(config, vacuumYear)) {
      laws.push({
        _id: new ObjectId(),
        billId: SEED_BILL_ID,
        ...seed,
        enactedAt: now,
      });
    }
  }

  return laws;
}

const NATIONAL_BUDGET_SEED_CONFIGS: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 2020,
    population: 333_000_000,
    gdp: 27_000_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 3.0,
      inflationRate: 2.5,
      tradeGrowth: 2.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.3537,
      corporateProfits: 0.0796,
      wagesAndSalaries: 0.3148,
      importValue: 0.1852,
      taxableSales: 0.5556,
    },
    otherRevenue: 200_000_000_000,
    debt: {
      principal: 28_500_000_000_000,
      interestRate: 0.021,
      ceiling: 31_400_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      healthcare: 650_000_000_000,
      defense: 800_000_000_000,
      socialSecurity: 900_000_000_000,
      education: 150_000_000_000,
      infrastructure: 120_000_000_000,
      other: 700_000_000_000,
    },
    baselineStateGrants: 600_000_000_000,
    policyDefaults: NATIONAL_DEFAULTS,
    policyOptionOverrides: NATIONAL_DEFAULT_OPTION_INDEXES,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
  {
    budgetId: "UK",
    countryId: "UK",
    fiscalYear: 2020,
    population: 68_000_000,
    gdp: 2_900_000_000_000,
    currencyCode: "GBP",
    economicFactors: {
      gdpGrowth: 1.2,
      wageGrowth: 3.1,
      inflationRate: 3.2,
      tradeGrowth: 1.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.5517,
      corporateProfits: 0.1655,
      wagesAndSalaries: 0.5345,
      importValue: 0.1552,
      taxableSales: 0.3293,
    },
    otherRevenue: 188_250_000_000,
    debt: {
      principal: 2_820_000_000_000,
      interestRate: 0.046,
      ceiling: 3_300_000_000_000,
      ceilingLastRaisedYear: 2024,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      health: 190_000_000_000,
      education: 95_000_000_000,
      statePensions: 135_000_000_000,
      welfare: 125_000_000_000,
      defense: 60_000_000_000,
      transport: 28_000_000_000,
      localGovernment: 40_000_000_000,
      other: 330_000_000_000,
    },
    baselineStateGrants: 75_000_000_000,
    policyRevenueConfigs: [
      {
        legislationTypeId: "uk_nhs_funding",
        revenueKey: "healthcareIncome",
        annualRevenuePerCapitaByOptionIndex: [500, 400, 300, 200, 120, 60, 30],
      },
    ],
    policyDefaults: UK_NATIONAL_DEFAULTS,
    policyOptionOverrides: UK_NATIONAL_DEFAULT_OPTION_INDEXES,
    taxPolicyIds: {
      incomeTax: "uk_income_tax_rate",
      domesticCorporateTax: "uk_domestic_corporation_tax",
      foreignCorporateTax: "uk_foreign_corporation_tax",
      payrollTax: "uk_national_insurance",
      tariffs: "uk_excise_customs",
      salesTax: "uk_vat",
    },
  },
  {
    budgetId: "JP",
    countryId: "JP",
    fiscalYear: 2020,
    population: 126_000_000,
    gdp: 550_000_000_000_000, // ~550 trillion JPY
    currencyCode: "JPY",
    economicFactors: {
      gdpGrowth: 0.6,
      wageGrowth: 1.0,
      inflationRate: 0.5,
      tradeGrowth: 0.3,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.4,
      corporateProfits: 0.12,
      wagesAndSalaries: 0.42,
      importValue: 0.14,
      taxableSales: 0.38,
    },
    otherRevenue: 12_000_000_000_000, // ~12 trillion JPY
    debt: {
      principal: 1_200_000_000_000_000, // ~1,200 trillion JPY (highest debt-to-GDP in world)
      interestRate: 0.01, // Near-zero rates
      ceiling: 1_500_000_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      health: 42_000_000_000_000,
      education: 5_500_000_000_000,
      statePensions: 58_000_000_000_000, // Massive pension spending — aging population
      welfare: 30_000_000_000_000,
      defense: 5_400_000_000_000,
      transport: 7_000_000_000_000,
      localGovernment: 16_000_000_000_000,
      other: 40_000_000_000_000,
    },
    baselineStateGrants: 18_000_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.jp.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.jp.optionIndexes,
    taxPolicyIds: {
      incomeTax: "jp_income_tax_rate",
      domesticCorporateTax: "jp_domestic_corporation_tax",
      foreignCorporateTax: "jp_foreign_corporation_tax",
      payrollTax: "jp_social_insurance",
      tariffs: "jp_customs_tariff",
      salesTax: "jp_consumption_tax",
    },
  },
  {
    budgetId: "DE",
    countryId: "DE",
    fiscalYear: 2020,
    population: 84_400_000,
    gdp: 4_500_000_000_000,
    currencyCode: "EUR",
    economicFactors: {
      gdpGrowth: 1.1,
      wageGrowth: 2.3,
      inflationRate: 1.8,
      tradeGrowth: 1.4,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.46,
      corporateProfits: 0.11,
      wagesAndSalaries: 0.44,
      importValue: 0.34,
      taxableSales: 0.5,
    },
    otherRevenue: 90_000_000_000,
    debt: {
      principal: 2_450_000_000_000,
      interestRate: 0.028,
      ceiling: 3_000_000_000_000,
      ceilingLastRaisedYear: 2024,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      health: 220_000_000_000,
      education: 85_000_000_000,
      pensions: 165_000_000_000,
      welfare: 120_000_000_000,
      defense: 65_000_000_000,
      transport: 55_000_000_000,
      localGovernment: 95_000_000_000,
      environment: 40_000_000_000,
      other: 210_000_000_000,
    },
    baselineStateGrants: 125_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.de.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.de.optionIndexes,
    taxPolicyIds: {
      incomeTax: "de_income_tax_rate",
      domesticCorporateTax: "de_domestic_corporate_tax_rate",
      foreignCorporateTax: "de_foreign_corporate_tax_rate",
      payrollTax: "de_payroll_social_insurance",
      tariffs: "de_customs_tariff_rate",
      salesTax: "de_vat_rate",
      solidaritySurcharge: "de_solidarity_surcharge",
    },
  },
  // ── Ireland ────────────────────────────────────────────────────────────────
  {
    budgetId: "IE",
    countryId: "IE",
    fiscalYear: 2023,
    population: 5_100_000,
    gdp: 500_000_000_000, // €500B (GDP inflated by MNC profit-shifting)
    currencyCode: "IEP",
    economicFactors: {
      gdpGrowth: 3.5,
      wageGrowth: 4.0,
      inflationRate: 3.2,
      tradeGrowth: 2.5,
      lastUpdated: new Date(),
    },
    // IE's headline GDP (€500B) is inflated ~2.3× by MNC profit-shifting vs real
    // domestic activity (GNI* ~€220B), so applying tax bases to it overstated
    // revenue to ~43% of GDP (real Irish tax take ~18-20%). Lower the
    // income/wage/sales base ratios accordingly (corporate kept high — MNC
    // corporation tax is genuinely large). fix/default-laws 2026-06-03.
    // currencyCode IEP at EUR-parity rate (0.92) — euro-era display shows €.
    taxBaseRatios: {
      taxableIncome: 0.13,
      corporateProfits: 0.22, // elevated due to MNC headquarters (real)
      wagesAndSalaries: 0.23,
      importValue: 0.28,
      taxableSales: 0.12,
    },
    otherRevenue: 8_000_000_000,
    debt: {
      principal: 235_000_000_000,
      interestRate: 0.025,
      ceiling: 300_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    creditRating: "AA",
    // Reconciled (fix/default-laws, 2026-06-03) to the Σ(per-capita × population)
    // of the IE default spending laws seeded from ieLegislationTypes, so the
    // no-laws fallback matches the with-laws expenditure breakdown.
    baselineSpendingByCategory: {
      health: 24_490_200_000,
      education: 10_985_400_000,
      socialProtection: 15_896_700_000,
      housing: 7_002_300_000,
      transport: 5_701_800_000,
      defense: 1_300_500_000,
      other: 11_796_300_000,
    },
    baselineStateGrants: 8_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.ie.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.ie.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ie_income_tax_rate",
      domesticCorporateTax: "ie_corporate_tax_rate",
      foreignCorporateTax: "ie_foreign_corporate_tax_rate",
      payrollTax: "ie_prsi",
      tariffs: "ie_customs_tariff_rate",
      salesTax: "ie_vat_rate",
      propertyTax: "ie_local_property_tax",
      stampDuty: "ie_stamp_duty",
      universalSocialCharge: "ie_usc",
      capitalGainsTax: "ie_capital_gains_tax",
      exciseDuty: "ie_excise_duty",
    },
  },
  // ── Brazil ─────────────────────────────────────────────────────────────────
  {
    budgetId: "BR",
    countryId: "BR",
    fiscalYear: 2023,
    population: 215_000_000,
    gdp: 10_900_000_000_000, // R$10.9T BRL
    currencyCode: "BRL",
    economicFactors: {
      gdpGrowth: 2.9,
      wageGrowth: 4.5,
      inflationRate: 4.6,
      tradeGrowth: 3.2,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.38,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.36,
      importValue: 0.15,
      taxableSales: 0.45,
    },
    otherRevenue: 400_000_000_000,
    debt: {
      principal: 6_800_000_000_000,
      interestRate: 0.105, // Selic rate
      ceiling: 9_000_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    creditRating: "BB",
    baselineSpendingByCategory: {
      socialSecurity: 1_900_000_000_000,
      health: 610_000_000_000,
      education: 400_000_000_000,
      defense: 180_000_000_000,
      infrastructure: 200_000_000_000,
      welfare: 550_000_000_000,
      other: 800_000_000_000,
    },
    baselineStateGrants: 450_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.br.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.br.optionIndexes,
    taxPolicyIds: {
      incomeTax: "br_income_tax_rate",
      domesticCorporateTax: "br_corporate_tax",
      payrollTax: "br_payroll_tax",
      salesTax: "br_vat_rate",
    },
    // BR taxPolicyIds reference unseeded legislation types → rates seed to 0.
    // Stopgap direct rates for the modern 2019 era (~33% of GDP, Brazil's real
    // tax burden). Tune when a BR legislation module lands.
    taxRateOverrides: {
      incomeTax: 25,
      domesticCorporateTax: 24,
      foreignCorporateTax: 24,
      payrollTax: 28,
      tariffs: 8,
      salesTax: 17,
    },
  },
  // ── China ──────────────────────────────────────────────────────────────────
  {
    budgetId: "CN",
    countryId: "CN",
    fiscalYear: 2023,
    population: 1_412_000_000,
    gdp: 126_000_000_000_000, // ¥126T CNY
    currencyCode: "CNY",
    economicFactors: {
      gdpGrowth: 5.2,
      wageGrowth: 5.0,
      inflationRate: 0.2,
      tradeGrowth: 4.5,
      lastUpdated: new Date(),
    },
    // CN income tax + social insurance were modelled at statutory rates against
    // broad bases, overstating revenue to ~42% of GDP (real Chinese individual
    // income tax is ~1% of GDP and the general-budget tax take ~17%). Lower the
    // income/wage bases to effective levels; VAT/corporate kept. fix/default-laws
    // 2026-06-03.
    taxBaseRatios: {
      taxableIncome: 0.03,
      corporateProfits: 0.14,
      wagesAndSalaries: 0.11,
      importValue: 0.18,
      taxableSales: 0.44,
    },
    otherRevenue: 2_000_000_000_000,
    debt: {
      principal: 32_000_000_000_000, // official central government debt ~25% of GDP
      interestRate: 0.035,
      ceiling: 40_000_000_000_000,
      ceilingLastRaisedYear: 2024,
    },
    creditRating: "A",
    // Reconciled (fix/default-laws, 2026-06-03) to the Σ(per-capita × population)
    // of the CN default spending laws seeded from cnLegislationTypes, so the
    // no-laws fallback matches the with-laws expenditure breakdown. publicSafety
    // (public security + criminal justice) is now its own line.
    baselineSpendingByCategory: {
      education: 4_100_448_000_000,
      socialSecurity: 3_899_944_000_000,
      infrastructure: 3_500_348_000_000,
      other: 3_138_876_000_000,
      agriculture: 2_401_812_000_000,
      publicSafety: 2_300_148_000_000,
      health: 2_199_896_000_000,
      defense: 1_599_796_000_000,
    },
    baselineStateGrants: 9_000_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.cn.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.cn.optionIndexes,
    taxPolicyIds: {
      incomeTax: "cn_individual_income_tax",
      domesticCorporateTax: "cn_enterprise_income_tax",
      // foreignCorporateTax intentionally omitted — CN unified EIT in 2008.
      // Engine falls back to domestic rate at seed time (see spec §13.1).
      payrollTax: "cn_social_insurance_contribution",
      tariffs: "cn_customs_tariff",
      salesTax: "cn_value_added_tax",
      landValueAddedTax: "cn_land_value_added_tax",
      urbanMaintenanceTax: "cn_urban_maintenance_construction_tax",
      stampDuty: "cn_stamp_duty",
    },
  },
  // ── Nigeria ────────────────────────────────────────────────────────────────
  // 2019 Buhari-era federal budget (~₦8.9T planned spending against ~₦4.4T
  // revenue; oil-revenue heavy, wide deficit financed by domestic borrowing).
  // GDP ~₦144T NGN (~$447B USD at 2019 ~₦306/USD). Narrow tax base (income tax
  // take ~1% of GDP); the bulk of revenue is oil rents captured in `otherRevenue`.
  {
    budgetId: "NG",
    countryId: "NG",
    fiscalYear: 2019,
    population: 200_000_000,
    gdp: 144_000_000_000_000, // ₦144T NGN
    currencyCode: "NGN",
    economicFactors: {
      gdpGrowth: 2.2,
      wageGrowth: 3.0,
      inflationRate: 11.4,
      tradeGrowth: 2.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.05, // very narrow personal income tax base
      corporateProfits: 0.03,
      wagesAndSalaries: 0.25,
      importValue: 0.15,
      taxableSales: 0.3, // VAT base is narrow (5% standard rate)
    },
    otherRevenue: 2_300_000_000_000, // oil rents — dominant revenue line
    debt: {
      principal: 25_000_000_000_000,
      interestRate: 0.13, // CBN Monetary Policy Rate
      ceiling: 40_000_000_000_000,
      ceilingLastRaisedYear: 2019,
    },
    creditRating: "B",
    // Reconciled to the NG spending calibration in ngLegislationTypes.ts
    // (Σ per-capita × 200M population per category). publicSafety + agriculture
    // are now explicit lines (previously folded into `other`).
    baselineSpendingByCategory: {
      socialSecurity: 1_500_000_000_000,
      healthcare: 300_000_000_000,
      education: 500_000_000_000,
      defense: 600_000_000_000,
      infrastructure: 2_000_000_000_000,
      welfare: 400_000_000_000,
      publicSafety: 200_000_000_000,
      agriculture: 300_000_000_000,
      other: 3_000_000_000_000,
    },
    baselineStateGrants: 1_000_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.ng.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.ng.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ng_personal_income_tax",
      domesticCorporateTax: "ng_companies_income_tax",
      foreignCorporateTax: "ng_petroleum_profit_tax",
      payrollTax: "ng_paye",
      salesTax: "ng_vat_rate",
    },
  },
];

// ─── 1991 fiscal configs (US FY1991, UK FY1991/92, JP FY1991, DE FY1991,
// IE FY1991, BR FY1991, CN FY1991). Nominal figures in local currency where
// applicable. Sources: BEA / OMB (US), HM Treasury (UK), MOF Japan (JP),
// Bundesbank / Destatis (DE), CSO Ireland (IE), IBGE / IMF (BR, hyperinflation-
// stabilized to early-1994 Real terms for game playability), World Bank /
// NBS (CN). Debt ceiling years pre-date 2011 ceiling-fight era; using the
// fiscalYear itself as a stand-in. ───────────────────────────────────────
const NATIONAL_BUDGET_SEED_CONFIGS_1991: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 1991,
    population: 252_177_000,
    gdp: 6_200_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: -0.1, // 1991 recession
      wageGrowth: 3.5,
      inflationRate: 4.2,
      tradeGrowth: 0.5,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.3537,
      corporateProfits: 0.0796,
      wagesAndSalaries: 0.3148,
      importValue: 0.1852,
      taxableSales: 0.5556,
    },
    otherRevenue: 45_000_000_000,
    debt: {
      principal: 3_665_000_000_000,
      interestRate: 0.075,
      ceiling: 4_145_000_000_000,
      ceilingLastRaisedYear: 1990,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      healthcare: 195_000_000_000,
      defense: 320_000_000_000,
      socialSecurity: 270_000_000_000,
      education: 45_000_000_000,
      infrastructure: 35_000_000_000,
      other: 210_000_000_000,
    },
    baselineStateGrants: 154_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.us.optionIndexes,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
  {
    budgetId: "UK",
    countryId: "UK",
    fiscalYear: 1991,
    population: 57_500_000,
    gdp: 600_000_000_000,
    currencyCode: "GBP",
    economicFactors: {
      gdpGrowth: -1.0, // 1991 UK recession (Major)
      wageGrowth: 5.0,
      inflationRate: 5.9,
      tradeGrowth: 0.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.5517,
      corporateProfits: 0.1655,
      wagesAndSalaries: 0.5345,
      importValue: 0.1552,
      taxableSales: 0.3293,
    },
    otherRevenue: 35_000_000_000,
    debt: {
      principal: 195_000_000_000,
      interestRate: 0.105,
      ceiling: 240_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AAA", // UK was AAA in 1991
    baselineSpendingByCategory: {
      health: 30_000_000_000,
      education: 25_000_000_000,
      statePensions: 30_000_000_000,
      welfare: 50_000_000_000,
      defense: 24_000_000_000,
      transport: 7_000_000_000,
      localGovernment: 15_000_000_000,
      other: 64_000_000_000,
    },
    baselineStateGrants: 18_000_000_000,
    policyRevenueConfigs: [
      {
        legislationTypeId: "uk_nhs_funding",
        revenueKey: "healthcareIncome",
        annualRevenuePerCapitaByOptionIndex: [500, 400, 300, 200, 120, 60, 30],
      },
    ],
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.uk.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.uk.optionIndexes,
    taxPolicyIds: {
      incomeTax: "uk_income_tax_rate",
      domesticCorporateTax: "uk_domestic_corporation_tax",
      foreignCorporateTax: "uk_foreign_corporation_tax",
      payrollTax: "uk_national_insurance",
      tariffs: "uk_excise_customs",
      salesTax: "uk_vat",
    },
  },
  {
    budgetId: "JP",
    countryId: "JP",
    fiscalYear: 1991,
    population: 124_000_000,
    gdp: 470_000_000_000_000, // ~470 trillion JPY nominal
    currencyCode: "JPY",
    economicFactors: {
      gdpGrowth: 3.4, // bubble peak just past
      wageGrowth: 4.0,
      inflationRate: 3.3,
      tradeGrowth: 2.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.4,
      corporateProfits: 0.12,
      wagesAndSalaries: 0.42,
      importValue: 0.14,
      taxableSales: 0.38,
    },
    otherRevenue: 8_000_000_000_000,
    debt: {
      principal: 167_000_000_000_000,
      interestRate: 0.058,
      ceiling: 195_000_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AAA", // Japan was AAA pre-1998
    baselineSpendingByCategory: {
      health: 18_000_000_000_000,
      education: 6_000_000_000_000,
      statePensions: 20_000_000_000_000,
      welfare: 14_000_000_000_000,
      defense: 4_300_000_000_000,
      publicWorks: 9_000_000_000_000,
      other: 28_000_000_000_000,
    },
    baselineStateGrants: 14_000_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.jp.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.jp.optionIndexes,
    taxPolicyIds: {
      incomeTax: "jp_income_tax_rate",
      domesticCorporateTax: "jp_domestic_corporation_tax",
      payrollTax: "jp_social_insurance",
      salesTax: "jp_consumption_tax",
    },
  },
  {
    budgetId: "DE",
    countryId: "DE",
    fiscalYear: 1991,
    population: 80_000_000, // post-reunification
    gdp: 1_600_000_000_000, // ~1.6 trillion DM nominal (treated as EUR-equivalent for game)
    currencyCode: "EUR",
    economicFactors: {
      gdpGrowth: 5.1, // reunification boom in West; East collapse
      wageGrowth: 5.0,
      inflationRate: 3.5,
      tradeGrowth: 2.5,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.48,
      corporateProfits: 0.11,
      wagesAndSalaries: 0.5,
      importValue: 0.22,
      taxableSales: 0.4,
    },
    otherRevenue: 60_000_000_000,
    debt: {
      principal: 600_000_000_000,
      interestRate: 0.085,
      ceiling: 750_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      health: 80_000_000_000,
      education: 50_000_000_000,
      socialSecurity: 110_000_000_000,
      defense: 32_000_000_000,
      infrastructure: 40_000_000_000,
      reunificationTransfers: 75_000_000_000,
      other: 80_000_000_000,
    },
    baselineStateGrants: 60_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.de.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.de.optionIndexes,
    taxPolicyIds: {
      incomeTax: "de_income_tax_rate",
      domesticCorporateTax: "de_domestic_corporate_tax_rate",
      foreignCorporateTax: "de_foreign_corporate_tax_rate",
      payrollTax: "de_payroll_social_insurance",
      tariffs: "de_customs_tariff_rate",
      salesTax: "de_vat_rate",
      solidaritySurcharge: "de_solidarity_surcharge",
    },
  },
  {
    budgetId: "IE",
    countryId: "IE",
    fiscalYear: 1991,
    population: 3_525_000,
    gdp: 24_000_000_000, // £IR 24B (1991 IEP; ~€34B at fixed IR£→EUR parity)
    currencyCode: "IEP",
    economicFactors: {
      gdpGrowth: 2.0, // pre-Celtic-Tiger
      wageGrowth: 4.0,
      inflationRate: 3.2,
      tradeGrowth: 1.5,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.5,
      corporateProfits: 0.1,
      wagesAndSalaries: 0.52,
      importValue: 0.4,
      taxableSales: 0.3,
    },
    otherRevenue: 2_500_000_000,
    debt: {
      principal: 32_000_000_000, // debt-to-GDP ~95%
      interestRate: 0.1,
      ceiling: 38_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AA",
    // Reconciled (fix/default-laws, 2026-06-03) to the IE default spending laws
    // scaled by the IE cost-scale low anchor (0.20; see COST_SCALE_ANCHORS in
    // src/lib/budget/costs.ts) — ~32% of 1991 GDP in categories; ~41.7% total incl.
    // debt service. Keys align to the legislation category vocabulary
    // (socialProtection/transport/housing).
    baselineSpendingByCategory: {
      health: 3_385_410_000,
      education: 1_518_570_000,
      socialProtection: 2_280_675_000,
      housing: 967_965_000,
      transport: 1_028_595_000,
      defense: 171_315_000,
      other: 1_630_665_000,
    },
    baselineStateGrants: 1_500_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.ie.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.ie.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ie_income_tax_rate",
      domesticCorporateTax: "ie_corporate_tax_rate",
      payrollTax: "ie_prsi",
      salesTax: "ie_vat_rate",
    },
  },
  {
    budgetId: "BR",
    countryId: "BR",
    fiscalYear: 1991,
    population: 149_000_000,
    // Brazil's 1991 nominal GDP figure is meaningless because of hyperinflation
    // (peaked >1,000% in 1990). We use the IMF's PPP-adjusted 1991 GDP
    // (~$900B equivalent) translated to a stable game-unit value in BRL using
    // the post-Real-Plan 1994 ratio.
    gdp: 900_000_000_000,
    currencyCode: "BRL",
    economicFactors: {
      gdpGrowth: 1.0, // post-Collor stabilization attempt
      wageGrowth: 50.0, // indexed against hyperinflation
      inflationRate: 480.0, // 1991 IPCA — actual; game treats this as a starting condition
      tradeGrowth: 0.5,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.3,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.32,
      importValue: 0.1,
      taxableSales: 0.4,
    },
    otherRevenue: 30_000_000_000,
    debt: {
      principal: 500_000_000_000,
      interestRate: 0.2, // hyperinflation surcharge
      ceiling: 700_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "B", // crisis-era
    baselineSpendingByCategory: {
      health: 25_000_000_000,
      education: 30_000_000_000,
      socialSecurity: 90_000_000_000,
      defense: 10_000_000_000,
      infrastructure: 15_000_000_000,
      other: 60_000_000_000,
    },
    baselineStateGrants: 70_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.br.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.br.optionIndexes,
    taxPolicyIds: {
      incomeTax: "br_income_tax_rate",
      domesticCorporateTax: "br_corporate_tax",
      payrollTax: "br_inss",
      salesTax: "br_icms",
    },
    // BR taxPolicyIds reference unseeded legislation types → rates seed to 0.
    // Stopgap direct rates for the post-1988-constitution 1991 era (~27% of GDP).
    // Tune when a BR legislation module lands.
    taxRateOverrides: {
      incomeTax: 22,
      domesticCorporateTax: 23,
      foreignCorporateTax: 23,
      payrollTax: 25,
      tariffs: 12,
      salesTax: 15,
    },
  },
  {
    budgetId: "CN",
    countryId: "CN",
    fiscalYear: 1991,
    population: 1_158_000_000,
    gdp: 2_178_000_000_000, // ~$378B USD / ~2.18 trillion CNY at 1991 ER
    currencyCode: "CNY",
    economicFactors: {
      gdpGrowth: 9.3, // Deng's "Southern Tour" era expansion (1992 reform peaked 14%)
      wageGrowth: 14.0,
      inflationRate: 3.4,
      tradeGrowth: 18.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.05, // small income-tax base pre-1994 reform
      corporateProfits: 0.06,
      wagesAndSalaries: 0.5,
      importValue: 0.18,
      taxableSales: 0.5,
    },
    otherRevenue: 40_000_000_000,
    debt: {
      principal: 120_000_000_000, // domestic debt only; foreign debt small
      interestRate: 0.085,
      ceiling: 180_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "BBB",
    // Reconciled (fix/default-laws, 2026-06-03) to the CN default spending laws
    // scaled by the CN cost-scale low anchor (0.02; see COST_SCALE_ANCHORS in
    // src/lib/budget/costs.ts) — ~17% of 1991 GDP. Adds the publicSafety line
    // (public security + criminal justice).
    baselineSpendingByCategory: {
      education: 67_256_640_000,
      infrastructure: 72_166_560_000,
      socialSecurity: 61_999_320_000,
      other: 50_164_560_000,
      agriculture: 39_395_160_000,
      health: 36_083_280_000,
      defense: 26_726_640_000,
      publicSafety: 22_627_320_000,
    },
    baselineStateGrants: 25_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.cn.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.cn.optionIndexes,
    taxPolicyIds: {
      incomeTax: "cn_individual_income_tax",
      domesticCorporateTax: "cn_enterprise_income_tax",
      // foreignCorporateTax intentionally omitted — CN unified EIT in 2008.
      // Engine falls back to domestic rate at seed time (see spec §13.1).
      payrollTax: "cn_social_insurance_contribution",
      tariffs: "cn_customs_tariff",
      salesTax: "cn_value_added_tax",
      landValueAddedTax: "cn_land_value_added_tax",
      urbanMaintenanceTax: "cn_urban_maintenance_construction_tax",
      stampDuty: "cn_stamp_duty",
    },
  },
  // ── Nigeria — Babangida-era SAP (1991 baseline) ────────────────────────────
  // 1991 Nigeria was under military rule (Babangida), mid-Structural Adjustment
  // Programme. Oil revenue dominant; naira devalued heavily post-1986 SAP. GDP
  // ~₦1.8T at 1991 current prices; inflation ~20% (SAP-driven). Figures are
  // plausible game-units rather than precise fiscal records (federal budgets
  // under military rule were opaque and heavily revised).
  {
    budgetId: "NG",
    countryId: "NG",
    fiscalYear: 1991,
    population: 95_000_000,
    gdp: 1_800_000_000_000, // ₦1.8T NGN (1991 current prices, post-SAP naira)
    currencyCode: "NGN",
    economicFactors: {
      gdpGrowth: 1.5, // SAP contraction easing
      wageGrowth: 15.0, // indexed against high inflation
      inflationRate: 20.0, // SAP-driven
      tradeGrowth: -1.0,
      lastUpdated: new Date(),
    },
    taxBaseRatios: {
      taxableIncome: 0.03,
      corporateProfits: 0.04,
      wagesAndSalaries: 0.2,
      importValue: 0.2,
      taxableSales: 0.25,
    },
    otherRevenue: 120_000_000_000, // oil rents (post-SAP naira)
    debt: {
      principal: 400_000_000_000,
      interestRate: 0.18, // high post-SAP borrowing costs
      ceiling: 600_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "B",
    baselineSpendingByCategory: {
      socialSecurity: 30_000_000_000,
      healthcare: 15_000_000_000,
      education: 25_000_000_000,
      defense: 40_000_000_000,
      infrastructure: 35_000_000_000,
      welfare: 10_000_000_000,
      other: 50_000_000_000,
    },
    baselineStateGrants: 20_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.ng.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.ng.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ng_personal_income_tax",
      domesticCorporateTax: "ng_companies_income_tax",
      foreignCorporateTax: "ng_petroleum_profit_tax",
      payrollTax: "ng_paye",
      salesTax: "ng_vat_rate",
    },
  },
  // ── France FY1991 — Mitterrand/Rocard budget (francs) ───────────────────────
  // GDP expressed at the game's 1991 FR rate (4.2 FRF/USD, mirroring the 1979
  // placeholder in INITIAL_RATES_1991): FFr 5,330B ≈ $1.27T USD-equivalent —
  // same convention the sibling 1991 configs use (local GDP / rate ≈ real USD
  // GDP). Spend ~50% of GDP (general-government scope), deficit ~1.6% (real
  // 1991 deficit ~2%); debt ~36% of GDP, franc-fort disinflation (~3.2%).
  {
    budgetId: "FR",
    countryId: "FR",
    fiscalYear: 1991,
    population: 57_000_000,
    gdp: 5_330_000_000_000, // ≈ FFr 5,330B (game units; see note above)
    currencyCode: "FRF",
    economicFactors: {
      gdpGrowth: 1.0, // 1991 slowdown (Gulf War + German-rate squeeze via the EMS)
      wageGrowth: 4.0,
      inflationRate: 3.2, // franc fort success — down from 10.8% in 1979
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.18, // IR + the new CSG broadening the base
      corporateProfits: 0.1,
      wagesAndSalaries: 0.5, // very high cotisations base
      importValue: 0.2,
      taxableSales: 0.52, // TVA base
    },
    otherRevenue: 290_000_000_000, // non-tax + local-tax proxy (~5.4% of GDP)
    debt: {
      principal: 1_920_000_000_000, // ≈ 36% of GDP
      interestRate: 0.09, // 1991 OAT yields ~9%
      ceiling: 2_500_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      socialSecurity: 1_000_000_000_000, // Sécurité sociale + RMI (largest line)
      healthcare: 480_000_000_000,
      education: 340_000_000_000,
      defense: 170_000_000_000, // ~3.2% of GDP, pre-peace-dividend force
      infrastructure: 130_000_000_000, // TGV Atlantique era
      other: 200_000_000_000,
    },
    baselineStateGrants: 80_000_000_000, // dotations to collectivités locales
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.fr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.fr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "fr_income_tax",
      domesticCorporateTax: "fr_corporate_tax",
      payrollTax: "fr_social_charges",
      tariffs: "fr_customs_tariff",
      salesTax: "fr_vat",
    },
  },
  // ── Italy FY1991 — Andreotti VII pre-Tangentopoli budget (lira) ─────────────
  // GDP at the game's 1991 IT rate (833 ITL/USD placeholder): ₤1,030,000B ≈
  // $1.24T USD-equivalent. The defining feature is the historically accurate
  // ~10%-of-GDP deficit: debt ~98% of GDP at ~11.5% BTP yields makes the
  // interest bill alone ~11% of GDP. Spend ~52%, revenue ~42%.
  {
    budgetId: "IT",
    countryId: "IT",
    fiscalYear: 1991,
    population: 56_800_000,
    gdp: 1_030_000_000_000_000, // ≈ ₤1,030,000B lira (game units; see note above)
    currencyCode: "ITL",
    economicFactors: {
      gdpGrowth: 1.5,
      wageGrowth: 7.0, // scala mobile winding down
      inflationRate: 6.3,
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.16,
      corporateProfits: 0.09,
      wagesAndSalaries: 0.42, // high INPS base
      importValue: 0.18,
      taxableSales: 0.32, // IVA base eroded by evasion
    },
    otherRevenue: 65_000_000_000_000, // non-tax + state-holding (IRI/ENI) income
    debt: {
      principal: 1_010_000_000_000_000, // ≈ 98% of GDP — the First Republic's legacy
      interestRate: 0.115, // 1991 BTP yields
      ceiling: 1_300_000_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 170_000_000_000_000, // pension-heavy (pre-Amato 1992 reform)
      healthcare: 65_000_000_000_000, // SSN
      education: 50_000_000_000_000,
      defense: 20_000_000_000_000,
      infrastructure: 45_000_000_000_000, // incl. state-holding investment
      other: 45_000_000_000_000,
    },
    baselineStateGrants: 25_000_000_000_000, // transfers to the regioni
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.it.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.it.optionIndexes,
    taxPolicyIds: {
      incomeTax: "it_income_tax",
      domesticCorporateTax: "it_corporate_tax",
      payrollTax: "it_social_charges",
      tariffs: "it_customs_tariff",
      salesTax: "it_vat",
    },
  },
  // ── Spain FY1991 — González III expansion budget (pesetas) ──────────────────
  // GDP at the game's 1991 ES rate (67 ESP/USD placeholder): ₧38,900B ≈ $0.58T
  // USD-equivalent. Peak post-Franco welfare buildout (universal healthcare
  // 1989, non-contributory pensions 1990) plus the 1992 Expo/Olympics/AVE
  // investment wave. Spend ~42%, deficit ~1.2% of GDP; debt ~44%.
  {
    budgetId: "ES",
    countryId: "ES",
    fiscalYear: 1991,
    population: 38_900_000,
    gdp: 38_900_000_000_000, // ≈ ₧38,900B pesetas (game units; see note above)
    currencyCode: "ESP",
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 8.0,
      inflationRate: 5.9,
      tradeGrowth: 4.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.18, // IRPF matured into the main pillar since 1979
      corporateProfits: 0.1,
      wagesAndSalaries: 0.4,
      importValue: 0.18,
      taxableSales: 0.55, // IVA base (introduced 1986)
    },
    otherRevenue: 2_720_000_000_000, // non-tax + INI dividends (~7% of GDP)
    debt: {
      principal: 17_100_000_000_000, // ≈ 44% of GDP
      interestRate: 0.1,
      ceiling: 22_000_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 5_600_000_000_000, // Seguridad Social pensions + new non-contributory tier
      healthcare: 2_400_000_000_000, // universal since the 1989 reform
      education: 1_800_000_000_000,
      defense: 700_000_000_000,
      infrastructure: 1_600_000_000_000, // AVE + Expo 92 + Olympics buildout
      other: 1_400_000_000_000,
    },
    baselineStateGrants: 1_100_000_000_000, // transfers to the autonomous communities
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.es.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.es.optionIndexes,
    taxPolicyIds: {
      incomeTax: "es_income_tax",
      domesticCorporateTax: "es_corporate_tax",
      payrollTax: "es_social_charges",
      tariffs: "es_customs_tariff",
      salesTax: "es_consumption_tax",
    },
  },
  // ── Sweden FY1991 — post-tax-reform, pre-crisis budget (kronor) ─────────────
  // GDP at the game's 1991 SE rate (4.29 SEK/USD placeholder): kr 1,160B ≈
  // $0.27T USD-equivalent. The 1990/91 "tax reform of the century" traded top
  // marginal cuts (~80%→~50%) for a broadened 25% Moms; the folkhem is at its
  // apex while the 1991-93 financial crisis begins. Spend ~52%, deficit ~1%.
  {
    budgetId: "SE",
    countryId: "SE",
    fiscalYear: 1991,
    population: 8_600_000,
    gdp: 1_160_000_000_000, // ≈ kr 1,160B (game units; see note above)
    currencyCode: "SEK",
    economicFactors: {
      gdpGrowth: -1.1, // 1991: the crisis recession begins
      wageGrowth: 5.5,
      inflationRate: 9.3, // 1990-91 cost spike before the disinflation
      tradeGrowth: 1.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.44, // still a very high direct-tax base post-reform
      corporateProfits: 0.05,
      wagesAndSalaries: 0.44, // arbetsgivaravgift base
      importValue: 0.25,
      taxableSales: 0.3, // broadened Moms base
    },
    otherRevenue: 63_000_000_000, // non-tax (~5.5% of GDP)
    debt: {
      principal: 500_000_000_000, // ≈ 43% of GDP, about to balloon in the crisis
      interestRate: 0.105, // 1991 krona-defense rates
      ceiling: 650_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "AAA", // lost only in the 1993 crisis downgrades
    baselineSpendingByCategory: {
      socialSecurity: 210_000_000_000, // pensions + universal benefits at the folkhem apex
      healthcare: 95_000_000_000,
      education: 75_000_000_000,
      defense: 30_000_000_000, // ~2.6% of GDP neutral armed forces
      infrastructure: 45_000_000_000,
      other: 55_000_000_000,
    },
    baselineStateGrants: 45_000_000_000, // transfers to municipalities/county councils
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.se.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.se.optionIndexes,
    taxPolicyIds: {
      incomeTax: "se_income_tax",
      domesticCorporateTax: "se_corporate_tax",
      payrollTax: "se_social_charges",
      tariffs: "se_customs_tariff",
      salesTax: "se_vat",
    },
  },
  // ── Turkey FY1991 — Özal-era liberalised-but-statist budget (lira) ──────────
  // GDP at the game's 1991 TR rate (34.5 TRL/USD placeholder): ₺6,900B ≈ $0.20T
  // USD-equivalent. (Real 1991 lira nominals were ~100x this after a decade of
  // ~60% inflation — the game keeps the 1979-continuity unit, same class of
  // abstraction as BR's PPP-normalised 1991 config.) Small state: spend ~25%
  // of GDP, deficit ~1.2% here (real PSBR was far worse); Gulf War shock year.
  {
    budgetId: "TR",
    countryId: "TR",
    fiscalYear: 1991,
    population: 57_300_000,
    gdp: 6_900_000_000_000, // ≈ ₺6,900B lira (game units; see note above)
    currencyCode: "TRL",
    economicFactors: {
      gdpGrowth: 0.9, // Gulf War shock year
      wageGrowth: 60.0, // chasing chronic ~60% inflation
      inflationRate: 66.0,
      tradeGrowth: 3.0, // post-liberalisation export orientation
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.16, // withholding-dominated collection
      corporateProfits: 0.05,
      wagesAndSalaries: 0.24, // SSK coverage still partial
      importValue: 0.12,
      taxableSales: 0.35, // KDV base (VAT introduced 1985)
    },
    otherRevenue: 386_000_000_000, // KİT/SEE income + central-bank transfers (~5.6% of GDP)
    debt: {
      principal: 2_000_000_000_000, // ≈ 29% of GDP
      interestRate: 0.24, // high nominal rates under chronic inflation
      ceiling: 2_800_000_000_000,
      ceilingLastRaisedYear: 1991,
    },
    creditRating: "BB", // pre-1994-crisis Turkey, better than 1979's B
    baselineSpendingByCategory: {
      defense: 260_000_000_000, // ~3.8% of GDP (NATO flank + internal security)
      socialSecurity: 240_000_000_000,
      education: 230_000_000_000,
      healthcare: 110_000_000_000,
      infrastructure: 240_000_000_000, // KİT investment + GAP southeast project
      other: 120_000_000_000,
    },
    baselineStateGrants: 60_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1991.tr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1991.tr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "tr_income_tax",
      domesticCorporateTax: "tr_corporate_tax",
      payrollTax: "tr_social_charges",
      tariffs: "tr_customs_tariff",
      salesTax: "tr_sales_tax",
    },
  },
];

// Authored independently for FY2023 — not derived from 2019 or 1991 configs.
export const NATIONAL_BUDGET_SEED_CONFIGS_2023: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 2023,
    population: 334_900_000,
    gdp: 27_400_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 4.3,
      inflationRate: 4.1,
      tradeGrowth: 1.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.3537,
      corporateProfits: 0.0796,
      wagesAndSalaries: 0.3148,
      importValue: 0.1852,
      taxableSales: 0.5556,
    },
    otherRevenue: 220_000_000_000,
    debt: {
      principal: 33_200_000_000_000,
      interestRate: 0.028,
      // FY2023 debt ceiling suspended by the Fiscal Responsibility Act (June 2023);
      // set above principal so the seed never reads as already in breach.
      ceiling: 33_400_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      healthcare: 1_700_000_000_000,
      defense: 800_000_000_000,
      socialSecurity: 1_350_000_000_000,
      education: 270_000_000_000,
      infrastructure: 150_000_000_000,
      other: 1_300_000_000_000,
    },
    baselineStateGrants: 1_100_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_2023.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_2023.us.optionIndexes,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
];

// Authored independently for FY2007 — not derived from 2019/2023/1991 configs.
// Real FY2007 actuals: GDP ≈ $14.45T, outlays ≈ $2.73T, receipts ≈ $2.57T,
// deficit ≈ $161B (1.1% GDP), gross federal debt ≈ $9.0T (debt/GDP ≈ 62%, of
// which ~36% held-by-public), AAA-rated (pre-2011 S&P downgrade).
export const NATIONAL_BUDGET_SEED_CONFIGS_2007: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 2007,
    population: 301_200_000,
    gdp: 14_450_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 1.9,
      wageGrowth: 4.0,
      inflationRate: 2.9,
      tradeGrowth: 2.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.3537,
      corporateProfits: 0.0796,
      wagesAndSalaries: 0.3148,
      importValue: 0.1852,
      taxableSales: 0.5556,
    },
    otherRevenue: 150_000_000_000,
    debt: {
      principal: 9_000_000_000_000,
      // 2007 Treasury rates materially higher than the 2019/2023 era.
      interestRate: 0.048,
      // Debt ceiling raised to $9.815T in Sept 2007.
      ceiling: 9_815_000_000_000,
      ceilingLastRaisedYear: 2007,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      healthcare: 630_000_000_000, // Medicare ≈ $440B + federal Medicaid ≈ $190B
      defense: 550_000_000_000, // base + Iraq/Afghanistan supplementals
      socialSecurity: 586_000_000_000,
      education: 90_000_000_000,
      infrastructure: 70_000_000_000,
      other: 800_000_000_000,
    },
    baselineStateGrants: 430_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_2007.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_2007.us.optionIndexes,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
];

// Authored independently for FY1999 — not derived from other-era configs.
// Real FY1999 actuals: GDP ≈ $9.66T, outlays ≈ $1.70T, receipts ≈ $1.83T,
// SURPLUS ≈ +$126B (+1.4% GDP), gross federal debt ≈ $5.6T, AAA-rated.
export const NATIONAL_BUDGET_SEED_CONFIGS_1999: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 1999,
    population: 279_000_000,
    gdp: 9_660_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 4.8,
      wageGrowth: 4.5,
      inflationRate: 2.2,
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.3537,
      corporateProfits: 0.0796,
      wagesAndSalaries: 0.3148,
      importValue: 0.1852,
      taxableSales: 0.5556,
    },
    otherRevenue: 100_000_000_000,
    debt: {
      principal: 5_600_000_000_000,
      // Late-1990s Treasury rates well above the 2019/2023 era.
      interestRate: 0.062,
      // Debt ceiling set to $5.95T in 1997 (it was not raised again until 2002,
      // as the surplus paid down debt held by the public).
      ceiling: 5_950_000_000_000,
      ceilingLastRaisedYear: 1997,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      healthcare: 313_000_000_000, // Medicare ≈ $205B + federal Medicaid ≈ $108B
      defense: 275_000_000_000, // post-Cold-War "peace dividend" low
      socialSecurity: 390_000_000_000,
      education: 60_000_000_000,
      infrastructure: 50_000_000_000,
      other: 612_000_000_000,
    },
    baselineStateGrants: 285_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1999.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1999.us.optionIndexes,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
];

/**
 * Builds a standard FY1979 planned-economy national budget config for a
 * Warsaw-Pact one-party state. Spending is set as a share of net material
 * product (heavy plan investment + consumer subsidies, modest defence).
 */
function makeEasternBlocBudget(
  countryId: NationalBudgetSeedConfig["countryId"],
  population: number,
  gdp: number,
  currencyCode: NationalBudgetSeedConfig["currencyCode"],
  factors: { gdpGrowth: number; inflationRate: number },
  debtPrincipal: number,
  creditRating: NationalBudgetSeedConfig["creditRating"]
): NationalBudgetSeedConfig[] {
  const prefix = countryId.toLowerCase();
  const pc = COUNTRY_POLICY_CONFIGS[prefix];
  return [
    {
      budgetId: countryId,
      countryId,
      fiscalYear: 1979,
      population,
      gdp,
      currencyCode,
      economicFactors: {
        gdpGrowth: factors.gdpGrowth,
        wageGrowth: factors.inflationRate + 2,
        inflationRate: factors.inflationRate,
        tradeGrowth: 3.0,
        lastUpdated: new Date(0),
      },
      // Fiscal-budget scale (same ruling-#15 discipline as makeEasternBlocBudget1953),
      // NOT the state's total economic footprint. The prior ratios (corp 0.62,
      // taxableSales 1.1, otherRevenue 18.5% GDP) were authored as if revenue
      // should approach plan-investment spend (~85% GDP). Charged at the milder
      // easternBlocPolicyConfig rates (enterprise 55%, product 16%) that still
      // produced ~83% GDP revenue — approaching or exceeding NMP. By 1979 the
      // satellites ran consumer-goods programmes and softer turnover regimes than
      // the Stalinist ladder, with large hard-currency debt (esp. Poland); Soviet-
      // type *fiscal* budgets of this decade sat roughly 45–65% of national income
      // (CIA NMP-to-budget series; RU seed already anchors ~57% with corp 0.32 /
      // sales 0.75). Bases below × the 1979 Brezhnev-era rate ladder land ~55% GDP
      // revenue against ~58% authored spend — a small planned deficit, command
      // composition intact, softer than 1953's Stalinist remittance rates.
      taxBaseRatios: {
        taxableIncome: 0.06, // wage tax still secondary — state set wages
        corporateProfits: 0.32, // SOE surplus remitted; fiscal claim, not whole NMP
        wagesAndSalaries: 0.4,
        importValue: 0.12,
        // Turnover-tax base ≈ gross retail/producer turnover relative to NMP.
        // Cap below 1.0 so the 16% Product Tax Schedule cannot alone clear 16% GDP.
        taxableSales: 0.75,
      },
      // Direct remittances + state property income (softer than 1953's extraction
      // intensity; consumer-goods programmes funded more via enterprise levy).
      otherRevenue: Math.round(gdp * 0.12),
      debt: {
        principal: debtPrincipal,
        interestRate: 0.06,
        ceiling: Math.round(debtPrincipal * 1.6),
        ceilingLastRaisedYear: 1979,
      },
      creditRating,
      // Same footprint→fiscal cut on the spend side: prior infrastructure 30% +
      // grants 10% + social lines totalled ~85% GDP (whole plan investment). Scaled
      // to near-balance the ~55% revenue — consumer/social lines higher than 1953
      // (Brezhnev-era social wage), industry/infrastructure still the largest line.
      baselineSpendingByCategory: {
        defense: Math.round(gdp * 0.05),
        socialSecurity: Math.round(gdp * 0.12),
        healthcare: Math.round(gdp * 0.05),
        education: Math.round(gdp * 0.06),
        infrastructure: Math.round(gdp * 0.18), // plan investment + consumer subsidies
        other: Math.round(gdp * 0.08),
      },
      baselineStateGrants: Math.round(gdp * 0.06),
      policyDefaults: pc.defaults,
      policyOptionOverrides: pc.optionIndexes,
      taxPolicyIds: easternBlocPolicyConfig(prefix).taxPolicyIds,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Authored independently for FY1979 — not derived from other-era configs.
// Real FY1979 actuals: GDP ≈ $2.63T, outlays ≈ $504B, receipts ≈ $463B,
// DEFICIT ≈ −$41B (−1.6% of GDP), gross federal debt ≈ $829B (≈33% of GDP — the
// pre-Reagan-deficits low), AAA-rated, Treasury rates high amid 11% inflation.
export const NATIONAL_BUDGET_SEED_CONFIGS_1979: NationalBudgetSeedConfig[] = [
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 1979,
    population: 225_000_000,
    gdp: 2_632_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 1.5, // 1979 real growth decelerating hard into the 1980 recession
      wageGrowth: 8.0, // high NOMINAL wage growth, but real wages falling under inflation
      inflationRate: 11.3, // 1979 CPI — the stagflation peak
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.283, // income knob index 6 (30%) × 0.283 ≈ 8.5% of GDP individual income tax
      corporateProfits: 0.072, // corporate knob index 9 (36%) × 0.072 ≈ 2.6% of GDP
      wagesAndSalaries: 0.45, // payroll knob index 4 (≈12%) × 0.45 ≈ 5.4% of GDP social insurance
      importValue: 0.1, // smaller pre-globalization trade share
      taxableSales: 0.5,
    },
    otherRevenue: 80_000_000_000, // excise + misc receipts (FY1979)
    debt: {
      principal: 829_000_000_000, // gross federal debt end-FY1979
      // 1979 Treasury rates well above every later era (10-yr ≈ 9%, bills ≈ 10%).
      interestRate: 0.095,
      // Debt ceiling raised to $879B in September 1979.
      ceiling: 879_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      healthcare: 42_000_000_000, // Medicare ≈ $29B + federal Medicaid ≈ $13B
      defense: 116_000_000_000, // FY1979 (the post-Vietnam low, just before the buildup)
      socialSecurity: 102_000_000_000, // OASDI outlays
      education: 13_000_000_000,
      infrastructure: 18_000_000_000,
      other: 213_000_000_000,
    },
    baselineStateGrants: 82_000_000_000, // federal grants-in-aid near their pre-Reagan peak
    policyDefaults: COUNTRY_POLICY_CONFIGS_1979.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1979.us.optionIndexes,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
  // ── USSR FY1979 — Soviet state budget (command economy, rubles) ─────────────
  // Real ~1979: state budget revenue/expenditure ≈ ₽276B, funded mainly by
  // enterprise profit remittances + the turnover tax; minimal external debt.
  {
    budgetId: "RU",
    countryId: "RU",
    fiscalYear: 1979,
    // Ukraine, Byelorussia and the Baltics left RU for their own countries and
    // took 66.7M of the 260.8M regional rollup with them. The budget figure is
    // scaled by the same share the old pair carried (245/260.8), so the gap
    // between the authored national population and the regional sum is
    // unchanged: 194.1M x 0.9394 = 182.3M.
    population: 182_300_000,
    // ≈ ₽439.5B (Western NMP-based estimate). Was ₽600B against a regional
    // rollup of ₽480,600M; the departed republics took ₽128,600M of that
    // rollup (UKR 95,000 + BEL 17,900 + BLT 15,700), leaving ₽352,000M. The
    // national figure is scaled by the same 352,000/480,600 ratio so the
    // rollup-to-national relationship reconcileStateGdp.ts sees is exactly
    // what it was before the split.
    gdp: 439_500_000_000,
    currencyCode: "SUR",
    economicFactors: {
      gdpGrowth: 2.5, // Brezhnev-era stagnation
      wageGrowth: 3.0,
      inflationRate: 1.0, // suppressed/official (shortages, not open inflation)
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    // Nominally balanced Soviet budget (refs #3246): profit remittances +
    // turnover tax extract the plan surplus, so revenue ≈ spend (~57% vs ~60%).
    taxBaseRatios: {
      taxableIncome: 0.05, // tiny flat wage tax
      corporateProfits: 0.32, // large state-enterprise surplus base
      wagesAndSalaries: 0.45,
      importValue: 0.1,
      taxableSales: 0.75, // turnover-tax base (gross turnover)
    },
    // As in 1953, every absolute rouble line is the whole-Union figure scaled by
    // 0.7325 (= ₽439.5B / ₽600B), RU's share of the regional GDP rollup after
    // Ukraine, Byelorussia and the Baltics left. Keeps the "revenue ≈ spend"
    // shape of refs #3246 instead of spending Union money on 73% of the economy.
    otherRevenue: 51_000_000_000,
    debt: {
      principal: 37_000_000_000, // minimal external debt
      interestRate: 0.02,
      ceiling: 88_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      defense: 44_000_000_000, // large military-industrial complex
      education: 22_000_000_000,
      healthcare: 9_000_000_000,
      socialSecurity: 33_000_000_000,
      infrastructure: 66_000_000_000, // "financing the national economy" (largest line)
      other: 29_000_000_000,
    },
    baselineStateGrants: 59_000_000_000, // transfers to the union republics
    policyDefaults: COUNTRY_POLICY_CONFIGS.su.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.su.optionIndexes,
    taxPolicyIds: {
      incomeTax: "su_individual_income_tax",
      domesticCorporateTax: "su_enterprise_levy",
      payrollTax: "su_social_insurance",
      tariffs: "su_customs_tariff",
      salesTax: "su_turnover_tax",
    },
  },
  // ── France FY1979 — Fifth Republic state budget (francs) ────────────────────
  // ~1979: GDP ≈ FFr 2,500B; large welfare state funded by TVA + income +
  // social charges; modest deficit and low public debt.
  {
    budgetId: "FR",
    countryId: "FR",
    fiscalYear: 1979,
    population: 53_400_000,
    gdp: 2_500_000_000_000, // ≈ FFr 2.5T
    currencyCode: "FRF",
    economicFactors: {
      gdpGrowth: 3.3,
      wageGrowth: 12.0, // high nominal (late-70s inflation)
      inflationRate: 10.8,
      tradeGrowth: 4.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.32,
      corporateProfits: 0.09,
      wagesAndSalaries: 0.45, // high social charges base
      importValue: 0.2,
      taxableSales: 0.55, // TVA base
    },
    otherRevenue: 80_000_000_000,
    debt: {
      principal: 520_000_000_000, // ≈ 21% of GDP (low in 1979)
      interestRate: 0.105,
      ceiling: 700_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      socialSecurity: 220_000_000_000, // Sécurité sociale (largest line)
      healthcare: 90_000_000_000,
      education: 90_000_000_000,
      defense: 70_000_000_000, // force de frappe
      infrastructure: 60_000_000_000,
      other: 80_000_000_000,
    },
    baselineStateGrants: 90_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.fr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.fr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "fr_income_tax",
      domesticCorporateTax: "fr_corporate_tax",
      payrollTax: "fr_social_charges",
      tariffs: "fr_customs_tariff",
      salesTax: "fr_vat",
    },
  },
  // ── Italy FY1979 — First Republic state budget (lira) ───────────────────────
  // ~1979: GDP ≈ ₤360,000B lira; chronic large deficits + pension-heavy welfare;
  // big state-holding sector (IRI/ENI). High inflation.
  {
    budgetId: "IT",
    countryId: "IT",
    fiscalYear: 1979,
    population: 56_400_000,
    gdp: 360_000_000_000_000, // ≈ ₤360,000B lira
    currencyCode: "ITL",
    economicFactors: {
      gdpGrowth: 4.0,
      wageGrowth: 18.0, // scala mobile + high inflation
      inflationRate: 14.8,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.3,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.42,
      importValue: 0.22,
      taxableSales: 0.5,
    },
    otherRevenue: 14_000_000_000_000,
    debt: {
      principal: 209_000_000_000_000, // ≈ 58% of GDP
      interestRate: 0.135,
      ceiling: 300_000_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 40_000_000_000_000, // pension-heavy
      healthcare: 16_000_000_000_000, // new SSN (1978)
      education: 14_000_000_000_000,
      defense: 8_000_000_000_000,
      infrastructure: 18_000_000_000_000, // incl. state-holding investment
      other: 18_000_000_000_000,
    },
    baselineStateGrants: 20_000_000_000_000, // transfers to the regioni
    policyDefaults: COUNTRY_POLICY_CONFIGS.it.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.it.optionIndexes,
    taxPolicyIds: {
      incomeTax: "it_income_tax",
      domesticCorporateTax: "it_corporate_tax",
      payrollTax: "it_social_charges",
      tariffs: "it_customs_tariff",
      salesTax: "it_vat",
    },
  },
  // ── Spain FY1979 — Transition state budget (pesetas) ────────────────────────
  // ~1979: GDP ≈ ₧15,000B pesetas; modest deficit, very low public debt (Franco
  // legacy); large INI state-holding sector; transition-era inflation.
  {
    budgetId: "ES",
    countryId: "ES",
    fiscalYear: 1979,
    population: 37_000_000,
    gdp: 15_000_000_000_000, // ≈ ₧15,000B pesetas
    currencyCode: "ESP",
    economicFactors: {
      gdpGrowth: 1.0,
      wageGrowth: 16.0, // Moncloa Pacts indexation + inflation
      inflationRate: 15.7,
      tradeGrowth: 4.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.26, // new IRPF, still building base
      corporateProfits: 0.08,
      wagesAndSalaries: 0.4,
      importValue: 0.18,
      taxableSales: 0.45,
    },
    otherRevenue: 600_000_000_000,
    debt: {
      principal: 2_400_000_000_000, // ≈ 16% of GDP (very low)
      interestRate: 0.14,
      ceiling: 4_000_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 1_500_000_000_000, // pensions (Seguridad Social)
      healthcare: 700_000_000_000,
      education: 700_000_000_000,
      defense: 400_000_000_000,
      infrastructure: 800_000_000_000, // incl. INI investment
      other: 700_000_000_000,
    },
    baselineStateGrants: 600_000_000_000, // transfers to the new autonomous communities
    policyDefaults: COUNTRY_POLICY_CONFIGS.es.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.es.optionIndexes,
    taxPolicyIds: {
      incomeTax: "es_income_tax",
      domesticCorporateTax: "es_corporate_tax",
      payrollTax: "es_social_charges",
      tariffs: "es_customs_tariff",
      salesTax: "es_consumption_tax",
    },
  },
  // ── Sweden FY1979 — the Swedish model state budget (kronor) ─────────────────
  // ~1979: GDP ≈ kr 500B; very high tax-to-GDP, large welfare spend, modest debt.
  {
    budgetId: "SE",
    countryId: "SE",
    fiscalYear: 1979,
    population: 8_300_000,
    gdp: 500_000_000_000, // ≈ kr 500B
    currencyCode: "SEK",
    economicFactors: {
      gdpGrowth: 3.8,
      wageGrowth: 9.0,
      inflationRate: 7.2,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.5, // very high direct-tax base
      corporateProfits: 0.06,
      wagesAndSalaries: 0.55, // high employer fees
      importValue: 0.28,
      taxableSales: 0.5,
    },
    otherRevenue: 30_000_000_000,
    debt: {
      principal: 150_000_000_000, // ≈ 30% of GDP
      interestRate: 0.09,
      ceiling: 220_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      socialSecurity: 70_000_000_000, // pensions + universal benefits
      healthcare: 40_000_000_000,
      education: 30_000_000_000,
      defense: 15_000_000_000, // sizeable neutral-armed-forces budget
      infrastructure: 25_000_000_000,
      other: 30_000_000_000,
    },
    baselineStateGrants: 55_000_000_000, // large transfers to municipalities/county councils
    policyDefaults: COUNTRY_POLICY_CONFIGS.se.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.se.optionIndexes,
    taxPolicyIds: {
      incomeTax: "se_income_tax",
      domesticCorporateTax: "se_corporate_tax",
      payrollTax: "se_social_charges",
      tariffs: "se_customs_tariff",
      salesTax: "se_vat",
    },
  },
  // ── Turkey FY1979 — pre-coup crisis budget (lira) ───────────────────────────
  // ~1979: GDP ≈ ₺2,200B lira; large deficit, FX crisis, ~60% inflation, étatist
  // KİT sector.
  {
    budgetId: "TR",
    countryId: "TR",
    fiscalYear: 1979,
    population: 43_500_000,
    gdp: 2_200_000_000_000, // ≈ ₺2,200B lira
    currencyCode: "TRL",
    economicFactors: {
      gdpGrowth: -0.5, // crisis recession
      wageGrowth: 50.0, // chasing runaway inflation
      inflationRate: 63.0,
      tradeGrowth: 2.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.18, // weak collection base
      corporateProfits: 0.07,
      wagesAndSalaries: 0.3,
      importValue: 0.1, // import-substitution: small import base
      taxableSales: 0.4,
    },
    otherRevenue: 120_000_000_000,
    debt: {
      principal: 550_000_000_000, // ≈ 25% of GDP (plus an acute FX/external crisis)
      interestRate: 0.3,
      ceiling: 900_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "B", // FX crisis, IMF negotiations
    baselineSpendingByCategory: {
      defense: 90_000_000_000, // large military (NATO, internal security)
      socialSecurity: 70_000_000_000,
      education: 55_000_000_000,
      healthcare: 35_000_000_000,
      infrastructure: 110_000_000_000, // KİT investment + subsidies
      other: 80_000_000_000,
    },
    baselineStateGrants: 70_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.tr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.tr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "tr_income_tax",
      domesticCorporateTax: "tr_corporate_tax",
      payrollTax: "tr_social_charges",
      tariffs: "tr_customs_tariff",
      salesTax: "tr_sales_tax",
    },
  },
  // ── Greece FY1979 — Karamanlis pre-accession budget (drachmae) ──────────────
  // ~1979: GDP ≈ ₯1,500B; second oil shock arriving, ~19% inflation, chronic
  // trade deficit bridged by shipping, tourism and emigrant remittances.
  {
    budgetId: "GR",
    countryId: "GR",
    fiscalYear: 1979,
    population: 9_500_000,
    gdp: 1_500_000_000_000, // ≈ ₯1,500B drachmae
    currencyCode: "GRD",
    economicFactors: {
      gdpGrowth: 3.3,
      wageGrowth: 18.0, // chasing inflation
      inflationRate: 19.0,
      tradeGrowth: 4.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.14, // endemic evasion; narrow declared base
      corporateProfits: 0.06,
      wagesAndSalaries: 0.26,
      importValue: 0.16,
      taxableSales: 0.38,
    },
    otherRevenue: 90_000_000_000, // state banks, DEI/OTE remittances, EEC pre-accession aid
    debt: {
      principal: 330_000_000_000, // ≈ 22% of GDP (the 1980s debt explosion hasn't happened yet)
      interestRate: 0.15,
      ceiling: 600_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "BBB",
    baselineSpendingByCategory: {
      defense: 90_000_000_000, // ~6% of GDP — the Aegean standoff with Turkey
      socialSecurity: 105_000_000_000,
      education: 60_000_000_000,
      healthcare: 55_000_000_000,
      infrastructure: 75_000_000_000,
      other: 60_000_000_000,
    },
    baselineStateGrants: 45_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.gr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.gr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "gr_income_tax",
      domesticCorporateTax: "gr_corporate_tax",
      payrollTax: "gr_social_charges",
      tariffs: "gr_customs_tariff",
      salesTax: "gr_sales_tax",
    },
  },
  // ── Austria FY1979 — Kreisky Austro-Keynesian budget (schilling) ────────────
  // ~1979: GDP ≈ öS 920B; hard-schilling D-Mark peg, ~3.7% inflation, near-full
  // employment bought with deliberate deficits and the ÖIAG nationalised sector.
  {
    budgetId: "AT",
    countryId: "AT",
    fiscalYear: 1979,
    population: 7_550_000,
    gdp: 920_000_000_000, // ≈ öS 920B schilling
    currencyCode: "ATS",
    economicFactors: {
      gdpGrowth: 4.7,
      wageGrowth: 6.0, // Parity Commission wage restraint
      inflationRate: 3.7,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.34, // broad wage-tax base, little evasion
      corporateProfits: 0.08,
      wagesAndSalaries: 0.44,
      importValue: 0.28, // small open economy
      taxableSales: 0.48,
    },
    otherRevenue: 40_000_000_000, // ÖIAG dividends, state monopolies (tobacco, salt), OeNB profit
    debt: {
      principal: 275_000_000_000, // ≈ 30% of GDP after the Austro-Keynesian deficit years
      interestRate: 0.08,
      ceiling: 500_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      defense: 11_000_000_000, // ~1.2% of GDP — neutral militia army
      socialSecurity: 95_000_000_000, // ASVG pensions + family allowances
      education: 50_000_000_000,
      healthcare: 45_000_000_000,
      infrastructure: 55_000_000_000,
      other: 45_000_000_000, // subsidies to the nationalised industries
    },
    baselineStateGrants: 40_000_000_000, // Finanzausgleich to Länder and Gemeinden
    policyDefaults: COUNTRY_POLICY_CONFIGS.at.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.at.optionIndexes,
    taxPolicyIds: {
      incomeTax: "at_income_tax",
      domesticCorporateTax: "at_corporate_tax",
      payrollTax: "at_social_charges",
      tariffs: "at_customs_tariff",
      salesTax: "at_sales_tax",
    },
  },
  // ── Finland FY1979 — late-Kekkonen devaluation-recovery budget (markka) ─────
  // ~1979: GDP ≈ mk 160B; the 1977–78 devaluations restored forest-industry
  // competitiveness, growth rebounding hard, Soviet bilateral trade absorbing
  // ~20% of exports; a famously low-debt state.
  {
    budgetId: "FI",
    countryId: "FI",
    fiscalYear: 1979,
    population: 4_770_000,
    gdp: 160_000_000_000, // ≈ mk 160B markka
    currencyCode: "FIM",
    economicFactors: {
      gdpGrowth: 6.5,
      wageGrowth: 9.0, // incomes-policy settlements chasing devaluation inflation
      inflationRate: 7.5,
      tradeGrowth: 8.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.36, // broad wage-tax base, Nordic compliance
      corporateProfits: 0.07,
      wagesAndSalaries: 0.46,
      importValue: 0.26,
      taxableSales: 0.44,
    },
    otherRevenue: 9_000_000_000, // state companies (Neste, Valmet), alcohol monopoly (Alko)
    debt: {
      principal: 19_000_000_000, // ≈ 12% of GDP — very low state debt
      interestRate: 0.09,
      ceiling: 60_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      defense: 2_400_000_000, // ~1.5% of GDP — conscript neutrality defence
      socialSecurity: 17_000_000_000, // KELA + earnings-related pensions
      education: 10_000_000_000, // peruskoulu rollout completing
      healthcare: 8_000_000_000, // universal health centres
      infrastructure: 9_000_000_000,
      other: 8_000_000_000, // farm income supports, regional policy
    },
    baselineStateGrants: 8_000_000_000, // state grants to municipalities (valtionosuudet)
    policyDefaults: COUNTRY_POLICY_CONFIGS.fi.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.fi.optionIndexes,
    taxPolicyIds: {
      incomeTax: "fi_income_tax",
      domesticCorporateTax: "fi_corporate_tax",
      payrollTax: "fi_social_charges",
      tariffs: "fi_customs_tariff",
      salesTax: "fi_sales_tax",
    },
  },
  // ── East Germany FY1979 — GDR state plan budget (Mark der DDR) ───────────────
  // ~1979: net material product ≈ M 180B; full-employment planned economy,
  // heavy consumer/rent subsidies, growing hidden hard-currency debt to the West.
  {
    budgetId: "DD",
    countryId: "DD",
    fiscalYear: 1979,
    population: 16_700_000,
    gdp: 180_000_000_000, // ≈ M 180B (net material product basis)
    currencyCode: "DDM",
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 3.5,
      inflationRate: 0.5, // administered prices
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    // Fiscal-budget scale (ruling #15), matching makeEasternBlocBudget: VEB profit
    // remittances + product levy land ~55% of NMP against ~58% authored spend —
    // not the prior footprint bases (corp 0.68, taxableSales 1.3) that produced
    // ~98% GDP revenue. GDR consumer/rent subsidies stay on the spend side.
    taxBaseRatios: {
      taxableIncome: 0.05, // low flat wage tax
      corporateProfits: 0.32, // VEB surplus remitted; fiscal claim, not whole NMP
      wagesAndSalaries: 0.4,
      importValue: 0.12,
      taxableSales: 0.75, // product-levy base; capped below 1.0
    },
    otherRevenue: Math.round(180_000_000_000 * 0.12), // direct VEB remittances + state property
    debt: {
      principal: 32_000_000_000, // incl. hidden hard-currency debt to the West
      interestRate: 0.05,
      ceiling: 60_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      socialSecurity: Math.round(180_000_000_000 * 0.12),
      healthcare: Math.round(180_000_000_000 * 0.05),
      education: Math.round(180_000_000_000 * 0.06),
      defense: Math.round(180_000_000_000 * 0.05), // NVA + Stasi
      infrastructure: Math.round(180_000_000_000 * 0.18), // plan investment + consumer/rent subsidies
      other: Math.round(180_000_000_000 * 0.08),
    },
    baselineStateGrants: Math.round(180_000_000_000 * 0.06),
    policyDefaults: COUNTRY_POLICY_CONFIGS.dd.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.dd.optionIndexes,
    taxPolicyIds: {
      incomeTax: "dd_income_tax",
      domesticCorporateTax: "dd_enterprise_levy",
      payrollTax: "dd_social_insurance",
      tariffs: "dd_foreign_trade",
      salesTax: "dd_product_tax",
    },
  },
  // ── Hungary FY1979 — MSZMP state plan budget (forint) ───────────────────────
  {
    budgetId: "HU",
    countryId: "HU",
    fiscalYear: 1979,
    population: 10_700_000,
    gdp: 800_000_000_000, // ≈ Ft 800B (net material product basis)
    currencyCode: "HUF",
    economicFactors: {
      gdpGrowth: 3.0,
      wageGrowth: 5.0,
      inflationRate: 4.0,
      tradeGrowth: 3.5,
      lastUpdated: new Date(0),
    },
    // Fiscal-budget scale (ruling #15), matching makeEasternBlocBudget: New
    // Economic Mechanism softened extraction vs orthodoxy, but the prior
    // footprint bases (corp 0.64, taxableSales 1.25) still produced ~92% GDP
    // revenue. Same fiscal bases as the shared helper land ~55% against ~58% spend.
    taxBaseRatios: {
      taxableIncome: 0.06,
      corporateProfits: 0.32, // SOE surplus remitted; fiscal claim, not whole NMP
      wagesAndSalaries: 0.4,
      importValue: 0.12,
      taxableSales: 0.75, // turnover-tax base; capped below 1.0
    },
    otherRevenue: Math.round(800_000_000_000 * 0.12), // direct remittances + state property
    debt: {
      principal: 180_000_000_000,
      interestRate: 0.07,
      ceiling: 280_000_000_000,
      ceilingLastRaisedYear: 1979,
    }, // notable Western debt
    creditRating: "A",
    baselineSpendingByCategory: {
      socialSecurity: Math.round(800_000_000_000 * 0.12),
      healthcare: Math.round(800_000_000_000 * 0.05),
      education: Math.round(800_000_000_000 * 0.06),
      defense: Math.round(800_000_000_000 * 0.05),
      infrastructure: Math.round(800_000_000_000 * 0.18),
      other: Math.round(800_000_000_000 * 0.08),
    },
    baselineStateGrants: Math.round(800_000_000_000 * 0.06),
    policyDefaults: COUNTRY_POLICY_CONFIGS.hu.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.hu.optionIndexes,
    taxPolicyIds: easternBlocPolicyConfig("hu").taxPolicyIds,
  },
  ...makeEasternBlocBudget(
    "PL",
    35_500_000,
    3_000_000_000_000,
    "PLZ",
    { gdpGrowth: 1.0, inflationRate: 6.0 },
    180_000_000_000,
    "BBB"
  ), // Gierek-era hard-currency debt
  ...makeEasternBlocBudget(
    "RO",
    22_000_000,
    800_000_000_000,
    "ROL",
    { gdpGrowth: 3.0, inflationRate: 2.0 },
    60_000_000_000,
    "BB"
  ), // Ceaușescu austerity to repay debt
  ...makeEasternBlocBudget(
    "YU",
    22_000_000,
    1_420_000_000_000,
    "YUD",
    { gdpGrowth: 4.0, inflationRate: 20.0 },
    200_000_000_000,
    "BB"
  ), // self-management, high inflation
  ...makeEasternBlocBudget(
    "BG",
    8_900_000,
    400_000_000_000,
    "BGL",
    { gdpGrowth: 3.0, inflationRate: 1.0 },
    18_000_000_000,
    "A"
  ),
  ...makeEasternBlocBudget(
    "BLR",
    9_500_000,
    450_000_000_000,
    "SUR",
    { gdpGrowth: 2.5, inflationRate: 0.5 },
    10_000_000_000,
    "AA"
  ),
  ...makeEasternBlocBudget(
    "UKR",
    49_800_000,
    875_000_000_000,
    "SUR",
    { gdpGrowth: 2.5, inflationRate: 0.5 },
    18_000_000_000,
    "AA"
  ),
  ...makeEasternBlocBudget(
    "CS",
    15_300_000,
    900_000_000_000,
    "CSK",
    { gdpGrowth: 2.5, inflationRate: 1.0 },
    20_000_000_000,
    "A"
  ),
  ...makeEasternBlocBudget(
    "BAL",
    7_400_000,
    420_000_000_000,
    "SUR",
    { gdpGrowth: 2.5, inflationRate: 0.5 },
    9_000_000_000,
    "AA"
  ),
  // ── United Kingdom FY1979 — Thatcher's first budget / oil shock ─────────────
  // GDP ≈ £245B; Thatcher's June 1979 budget: VAT doubled 8%→15%, income tax top
  // rate cut 83%→60% (basic 33%→30%); inflation 13.4%; entering the 1980 recession.
  {
    budgetId: "UK",
    countryId: "UK",
    fiscalYear: 1979,
    population: 56_200_000,
    gdp: 245_000_000_000,
    currencyCode: "GBP",
    economicFactors: {
      gdpGrowth: -2.2, // start of the Thatcher recession
      wageGrowth: 15.0, // high nominal wages (13.4% CPI)
      inflationRate: 13.4,
      tradeGrowth: 1.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.45,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.48,
      importValue: 0.28,
      taxableSales: 0.45, // VAT doubled to 15%
    },
    otherRevenue: 12_000_000_000,
    debt: {
      principal: 87_000_000_000, // ~44% GDP
      interestRate: 0.14, // Thatcher tight-money — PSBR squeeze
      ceiling: 100_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      healthcare: 12_000_000_000, // NHS
      defense: 9_500_000_000, // NATO commitment (rising toward 3% GDP target)
      socialSecurity: 20_000_000_000, // unemployment rising + pensions
      education: 9_000_000_000,
      infrastructure: 5_000_000_000,
      other: 20_000_000_000,
    },
    baselineStateGrants: 15_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.uk.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.uk.optionIndexes,
    taxPolicyIds: {
      incomeTax: "uk_income_tax_rate",
      domesticCorporateTax: "uk_domestic_corporation_tax",
      foreignCorporateTax: "uk_foreign_corporation_tax",
      payrollTax: "uk_national_insurance",
      tariffs: "uk_excise_customs",
      salesTax: "uk_vat",
    },
  },
  // ── West Germany FY1979 — Schmidt / EMS anchor / Sozialstaat peak ───────────
  // GDP ≈ DM 1,254B; DM pillar of new EMS (March 1979); Bundesbank credibility
  // kept inflation at 4.1% vs. double-digit neighbours; Sozialstaat ~25% GDP.
  // currencyCode EUR = game proxy for Deutsche Mark (display layer handles name).
  {
    budgetId: "DE",
    countryId: "DE",
    fiscalYear: 1979,
    population: 61_400_000,
    gdp: 1_254_000_000_000,
    currencyCode: "EUR",
    economicFactors: {
      gdpGrowth: 4.2,
      wageGrowth: 6.0,
      inflationRate: 4.1,
      tradeGrowth: 7.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.35,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.48, // Bismarckian social charges dominant
      importValue: 0.22,
      taxableSales: 0.5,
    },
    otherRevenue: 30_000_000_000,
    debt: {
      principal: 320_000_000_000, // ~26% GDP — very low by later standards
      interestRate: 0.08,
      ceiling: 400_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      socialSecurity: 280_000_000_000, // pensions + unemployment + social assistance
      healthcare: 60_000_000_000,
      education: 30_000_000_000, // Bund share; Länder pay most
      defense: 43_000_000_000, // NATO 3% target; Bundeswehr
      infrastructure: 35_000_000_000,
      other: 50_000_000_000,
    },
    baselineStateGrants: 80_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.de.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.de.optionIndexes,
    taxPolicyIds: {
      incomeTax: "de_income_tax_rate",
      domesticCorporateTax: "de_domestic_corporate_tax_rate",
      foreignCorporateTax: "de_foreign_corporate_tax_rate",
      payrollTax: "de_payroll_social_insurance",
      tariffs: "de_customs_tariff_rate",
      salesTax: "de_vat_rate",
      solidaritySurcharge: "de_solidarity_surcharge",
    },
  },
  // ── Japan FY1979 — LDP / MITI industrial policy / second oil shock ───────────
  // GDP ≈ ¥230T (≈ $1.07T at ¥215/USD); Ohira cabinet; second oil shock hit
  // manufacturing; MITI targeted support; SDF ≈ 1% GDP (Article 9 strict).
  {
    budgetId: "JP",
    countryId: "JP",
    fiscalYear: 1979,
    population: 115_900_000,
    gdp: 230_000_000_000_000,
    currencyCode: "JPY",
    economicFactors: {
      gdpGrowth: 5.3,
      wageGrowth: 4.5,
      inflationRate: 3.6,
      tradeGrowth: 6.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.28,
      corporateProfits: 0.09,
      wagesAndSalaries: 0.4,
      importValue: 0.12,
      taxableSales: 0.38, // no consumption tax yet (introduced 1989)
    },
    otherRevenue: 4_000_000_000_000,
    debt: {
      principal: 70_000_000_000_000, // ~30% GDP; rising via deficit-bond financing
      interestRate: 0.08,
      ceiling: 85_000_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 14_000_000_000_000,
      healthcare: 6_000_000_000_000,
      education: 5_000_000_000_000,
      defense: 2_100_000_000_000, // 1% GDP cap strictly observed
      publicWorks: 11_000_000_000_000, // Tanaka-era public works legacy
      other: 8_000_000_000_000,
    },
    baselineStateGrants: 10_000_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.jp.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.jp.optionIndexes,
    taxPolicyIds: {
      incomeTax: "jp_income_tax_rate",
      domesticCorporateTax: "jp_domestic_corporation_tax",
      foreignCorporateTax: "jp_foreign_corporation_tax",
      payrollTax: "jp_social_insurance",
      tariffs: "jp_customs_tariff",
      salesTax: "jp_consumption_tax",
    },
  },
  // ── China FY1979 — Deng reform era / Four Modernizations / SEZs ─────────────
  // GDP ≈ ¥CNY 559B; Deng consolidates power Jan 1979; SEZs authorized July 1979;
  // Sino-Vietnamese War Feb 1979; state planning still dominant; rural reform begins.
  {
    budgetId: "CN",
    countryId: "CN",
    fiscalYear: 1979,
    population: 977_000_000,
    gdp: 559_000_000_000,
    currencyCode: "CNY",
    economicFactors: {
      gdpGrowth: 7.6,
      wageGrowth: 5.0,
      inflationRate: 2.0, // official; shortages differ
      tradeGrowth: 8.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.02, // no individual income tax yet (introduced 1981)
      corporateProfits: 0.35, // state enterprise profit remittances dominant
      wagesAndSalaries: 0.38,
      importValue: 0.08,
      taxableSales: 0.42,
    },
    otherRevenue: 20_000_000_000,
    debt: {
      principal: 8_000_000_000,
      interestRate: 0.04,
      ceiling: 30_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "B",
    baselineSpendingByCategory: {
      defense: 23_000_000_000, // PLA; Sino-Vietnamese War
      education: 10_000_000_000,
      infrastructure: 70_000_000_000, // plan investment; heavy industry
      agriculture: 11_000_000_000, // rural reform incentives
      socialSecurity: 5_000_000_000,
      other: 20_000_000_000,
    },
    baselineStateGrants: 15_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.cn.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.cn.optionIndexes,
    taxPolicyIds: {
      incomeTax: "cn_individual_income_tax",
      domesticCorporateTax: "cn_enterprise_income_tax",
      payrollTax: "cn_social_insurance_contribution",
      tariffs: "cn_customs_tariff",
      salesTax: "cn_value_added_tax",
      landValueAddedTax: "cn_land_value_added_tax",
      urbanMaintenanceTax: "cn_urban_maintenance_construction_tax",
      stampDuty: "cn_stamp_duty",
    },
  },
  // ── Brazil FY1979 — military regime / economic miracle fading ────────────────
  // GDP ≈ Cr$ 9.5T cruzeiros (≈ $226B); Figueiredo government; 80% oil imported;
  // second oil shock devastating; foreign debt ballooning; indexação; 77% inflation.
  // currencyCode BRL = game proxy for cruzeiro (display layer handles name).
  {
    budgetId: "BR",
    countryId: "BR",
    fiscalYear: 1979,
    population: 121_000_000,
    gdp: 9_500_000_000_000,
    currencyCode: "BRL",
    economicFactors: {
      gdpGrowth: 6.4,
      wageGrowth: 60.0, // high nominal; 77% CPI
      inflationRate: 77.2,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.18,
      corporateProfits: 0.07,
      wagesAndSalaries: 0.35,
      importValue: 0.1,
      taxableSales: 0.4,
    },
    otherRevenue: 400_000_000_000,
    debt: {
      principal: 1_500_000_000_000, // foreign debt crisis building (will peak 1982)
      interestRate: 0.2,
      ceiling: 2_500_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "BB",
    baselineSpendingByCategory: {
      socialSecurity: 800_000_000_000,
      healthcare: 300_000_000_000,
      education: 500_000_000_000,
      defense: 350_000_000_000,
      infrastructure: 2_000_000_000_000, // Petrobras, Itaipu Dam, BR-2010 roads
      other: 1_000_000_000_000,
    },
    baselineStateGrants: 600_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.br.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.br.optionIndexes,
    taxPolicyIds: {
      incomeTax: "br_income_tax_rate",
      domesticCorporateTax: "br_corporate_tax",
      payrollTax: "br_inss",
      salesTax: "br_icms",
    },
    // BR taxPolicyIds reference unseeded legislation types → rates seed to 0.
    // Stopgap direct rates for the 1979 military-developmentalist era (~25% of
    // GDP). Tune when a BR legislation module lands.
    taxRateOverrides: {
      incomeTax: 20,
      domesticCorporateTax: 22,
      foreignCorporateTax: 22,
      payrollTax: 22,
      tariffs: 15,
      salesTax: 13,
    },
  },
  // ── Ireland FY1979 — EEC transfers / public borrowing surge / EMS entry ─────
  // GDP ≈ £IR 9.4B; EMS entry March 1979 breaks 150-yr sterling parity;
  // Lynch→Haughey Dec 1979; borrowing ≈ 14% GDP; 10% mfg CT rate attracting MNCs.
  {
    budgetId: "IE",
    countryId: "IE",
    fiscalYear: 1979,
    population: 3_370_000,
    gdp: 9_400_000_000,
    currencyCode: "IEP",
    economicFactors: {
      gdpGrowth: 3.9,
      wageGrowth: 17.0, // high nominal (13.2% CPI)
      inflationRate: 13.2,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.38,
      corporateProfits: 0.06, // 10% mfg CT rate; low effective rate
      wagesAndSalaries: 0.42,
      importValue: 0.45, // very open economy (X+M ≈ 110% GDP)
      taxableSales: 0.4,
    },
    otherRevenue: 350_000_000,
    debt: {
      principal: 4_200_000_000, // ~45% GDP; rising sharply
      interestRate: 0.15,
      ceiling: 6_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      socialProtection: 1_200_000_000,
      healthcare: 700_000_000,
      education: 500_000_000,
      defense: 70_000_000, // Defence Forces; neutral
      infrastructure: 400_000_000,
      other: 600_000_000,
    },
    baselineStateGrants: 200_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS.ie.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.ie.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ie_income_tax_rate",
      domesticCorporateTax: "ie_corporate_tax_rate",
      payrollTax: "ie_prsi",
      salesTax: "ie_vat_rate",
    },
  },
  // ── Nigeria FY1979 — oil boom peak / civilian handover (Shagari) ─────────────
  // GDP ≈ ₦23B ($34B; ₦0.67/USD); 2.3M bbl/day oil peak; Obasanjo→Shagari Oct
  // 1979 civilian handover; Dutch Disease onset — agriculture severely neglected.
  {
    budgetId: "NG",
    countryId: "NG",
    fiscalYear: 1979,
    population: 71_000_000,
    gdp: 23_000_000_000,
    currencyCode: "NGN",
    economicFactors: {
      gdpGrowth: 5.5,
      wageGrowth: 14.0,
      inflationRate: 11.8,
      tradeGrowth: 8.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.05,
      corporateProfits: 0.25, // petroleum profit tax + oil company remittances
      wagesAndSalaries: 0.22,
      importValue: 0.3, // petrodollar import boom
      taxableSales: 0.25,
    },
    otherRevenue: 3_000_000_000, // oil royalties
    debt: {
      principal: 2_500_000_000,
      interestRate: 0.1,
      ceiling: 6_000_000_000,
      ceilingLastRaisedYear: 1979,
    },
    creditRating: "BB",
    baselineSpendingByCategory: {
      infrastructure: 7_000_000_000, // oil-boom splurge; ports, roads, FESTAC legacy
      education: 2_500_000_000, // UPE (Universal Primary Education) legacy
      defense: 1_800_000_000,
      healthcare: 800_000_000,
      socialSecurity: 400_000_000,
      other: 2_500_000_000,
    },
    baselineStateGrants: 5_000_000_000, // large oil-derived federal transfers to states
    policyDefaults: COUNTRY_POLICY_CONFIGS.ng.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS.ng.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ng_personal_income_tax",
      domesticCorporateTax: "ng_companies_income_tax",
      payrollTax: "ng_paye",
      salesTax: "ng_vat_rate",
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// FY1953 — Bretton Woods / Korean War / Early Cold War.
// US: Treasury Historical Tables; UN Statistical Yearbook 1955; OEEC Economic
// Surveys; Mitchell's International Historical Statistics.
// USSR/Bloc: Western CIA/RAND NMP estimates (CIA FOIA, Bergson series).
// ─────────────────────────────────────────────────────────────────────────────

function makeEasternBlocBudget1953(
  countryId: NationalBudgetSeedConfig["countryId"],
  population: number,
  gdp: number,
  currencyCode: NationalBudgetSeedConfig["currencyCode"],
  factors: { gdpGrowth: number; inflationRate: number },
  debtPrincipal: number,
  creditRating: NationalBudgetSeedConfig["creditRating"]
): NationalBudgetSeedConfig[] {
  const prefix = countryId.toLowerCase();
  // Prefer era-authored 1953 defaults; fall back to the shared map for bloc
  // countries that do not yet have a dedicated 1953 policy config (HU/PL/…).
  const pc = COUNTRY_POLICY_CONFIGS_1953[prefix] ?? COUNTRY_POLICY_CONFIGS[prefix];
  return [
    {
      budgetId: countryId,
      countryId,
      fiscalYear: 1953,
      population,
      gdp,
      currencyCode,
      economicFactors: {
        gdpGrowth: factors.gdpGrowth,
        wageGrowth: factors.inflationRate + 2,
        inflationRate: factors.inflationRate,
        tradeGrowth: 2.0,
        lastUpdated: new Date(0),
      },
      // Fiscal-budget scale (RU/DD ruling-#15 discipline), NOT the state's total
      // economic footprint. The prior ratios (corp 0.60, taxableSales 1.05,
      // otherRevenue 15.5% GDP) were authored for ~76% GDP revenue under the
      // milder shared easternBlocPolicyConfig rates (enterprise 55%, product
      // 16%). COUNTRY_POLICY_CONFIGS_1953 wires easternBlocPolicyConfig1953
      // instead — Total Surplus Remittance (70%) + Maximal Turnover Tax (26%)
      // — so those footprint bases produced 96–107% GDP revenue (enterprise
      // remittance alone ≈42% GDP). Soviet-type *fiscal* budgets of this era
      // ran ~45–70% of national income (turnover tax + profit remittances the
      // bulk; see Holzman / CIA NMP-to-budget series). Bases below × the 1953
      // Stalinist rate ladder land ~52% GDP revenue against ~54% authored
      // spend — a small planned deficit, command-economy composition intact.
      taxBaseRatios: {
        taxableIncome: 0.2, // wage tax secondary — the state set wages directly
        corporateProfits: 0.18, // SOE surplus remitted; fiscal claim, not whole NMP
        wagesAndSalaries: 0.35,
        importValue: 0.1,
        // Turnover-tax base ≈ gross retail/producer turnover relative to NMP.
        // Cap below 1.0 so the 26% Maximal Turnover Tax cannot alone clear 26% GDP.
        taxableSales: 0.6,
      },
      // Direct remittances + state property income (Holzman: non-tax ≈10–15% of
      // Soviet-type budget receipts in the early 1950s).
      otherRevenue: Math.round(gdp * 0.12),
      debt: {
        principal: debtPrincipal,
        interestRate: 0.04,
        ceiling: Math.round(debtPrincipal * 2.0),
        ceilingLastRaisedYear: 1953,
      },
      creditRating,
      // Same footprint→fiscal cut on the spend side: prior infrastructure 32% +
      // grants 8% + social lines totalled ~79% GDP (the state's whole plan
      // investment, not the fiscal outlay). Scaled to near-balance the ~52%
      // revenue — industry/infrastructure remains the largest single line.
      baselineSpendingByCategory: {
        defense: Math.round(gdp * 0.07), // Stalinist militarization higher than 1979
        socialSecurity: Math.round(gdp * 0.08),
        healthcare: Math.round(gdp * 0.04),
        education: Math.round(gdp * 0.05),
        infrastructure: Math.round(gdp * 0.18), // heavy-industry plan investment
        other: Math.round(gdp * 0.07),
      },
      baselineStateGrants: Math.round(gdp * 0.05),
      policyDefaults: pc.defaults,
      policyOptionOverrides: pc.optionIndexes,
      taxPolicyIds: easternBlocPolicyConfig(prefix).taxPolicyIds,
    },
  ];
}

// Real FY1953 actuals:
//   US — GDP $387B, outlays $76.1B, receipts $69.6B, deficit –$6.5B,
//     gross debt $275B (~71% GDP), AAA-rated, 92% top marginal rate, 52% corporate rate.
//   UK — GDP £14.4B, defence £1.6B (Korean War/NATO peak), NHS £570M first full year.
//   SU — NMP ≈ ₽1.4T (CIA Bergson), defense officially secret (~20% of NMP).
//   FR — GDP ≈ FFr 16,450B ($47B); Indochina War draining ~8% GDP on defence.
//   IT — GDP ≈ ₤10.6T lira ($17B); 'Miracolo Economico' just beginning.
//   ES — GDP ≈ ₧198B pesetas (autarky); Franco + US base treaty 1953 sign-off.
//   SE — GDP ≈ kr 36B; Swedish Model at full sail; neutrality + strong welfare.
//   TR — GDP ≈ ₺24B; Menderes boom; NATO 1952; US aid (Marshall Plan successor).
//   DE — GDP ≈ DEM 138B (~$33B); Wirtschaftswunder; no Bundeswehr until 1955.
//   JP — GDP ≈ ¥9.3T; post-Occupation recovery; Article 9 → tiny defence.
//   CN — GDP ≈ ¥CNY 82B; First Five-Year Plan + Soviet aid; Korean War ending.
//   BR — GDP ≈ Cr$ 330B ($18B); Vargas era ISI; Petrobras founded Aug 1953.
//   IE — GDP ≈ £IR 340M; emigration crisis; at par with GBP.
//   NG — Colonial Nigeria under British Crown; exports of groundnuts/cocoa/palm oil.
/**
 * 1953 preset national-budget seed configs.
 *
 * ## GDP denomination convention
 *
 * By deliberate design, country GDP is stored in LOCAL CURRENCY — the UK in
 * pounds, the USSR in rubles, France in francs, etc. Cross-country GDP
 * comparison is invalid and that is accepted.
 *
 * However, a subset of 1953 countries have their GDP values stored in USD
 * (their `currencyCode` is display-only). These are:
 *   - IT (Italy):   $17B  — ₤10.6T / 625 ITL/USD
 *   - JP (Japan):   $25.8B — ¥9.3T / 360 JPY/USD
 *   - CN (China):   $33.3B — ¥CNY 82B / 2.46 CNY/USD
 *   - NG (Nigeria): $3.4B  — £1.2B WAP × $2.80/£
 *
 * All other 1953 countries are local-currency. The machine-readable marker
 * lives in `gdpDenomination.ts` (`GDP_DENOMINATION_1953`) and is pinned by
 * a guard test. Do NOT add a new USD-anchored country without updating both.
 *
 * See gdpDenomination.ts for the definitive table.
 */
export const NATIONAL_BUDGET_SEED_CONFIGS_1953: NationalBudgetSeedConfig[] = [
  // ── United States FY1953 — Eisenhower / 83rd Congress ───────────────────────
  {
    budgetId: "federal",
    countryId: "US",
    fiscalYear: 1953,
    population: 158_000_000,
    gdp: 387_000_000_000,
    currencyCode: "USD",
    economicFactors: {
      gdpGrowth: 4.6, // 1953 real GDP growth
      wageGrowth: 4.5,
      inflationRate: 0.75, // near-zero; 1953 CPI essentially flat
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.35, // high 92% rate but narrower filer base than later eras
      corporateProfits: 0.08, // 52% statutory rate; large corporate profit pool
      wagesAndSalaries: 0.4, // OASDI combined 3.0% (employee+employer) — very low
      importValue: 0.06, // US still largely self-sufficient; smaller trade share
      taxableSales: 0.4,
    },
    otherRevenue: 15_000_000_000, // excise + estate taxes + misc receipts
    debt: {
      principal: 275_000_000_000, // gross federal debt end-FY1953
      interestRate: 0.025, // Fed Accord (1951) → Treasuries ~2.5%
      ceiling: 290_000_000_000, // debt ceiling at the time
      ceilingLastRaisedYear: 1954,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      defense: 52_800_000_000, // Korean War + NATO buildup; ~14% GDP
      socialSecurity: 3_500_000_000, // 1950/52 amendments; still modest
      healthcare: 1_600_000_000, // VA hospitals only; no Medicare/Medicaid
      education: 700_000_000, // almost entirely state-funded; minimal federal
      infrastructure: 1_400_000_000, // pre-Interstate Highway System (Act: 1956)
      other: 16_100_000_000,
    },
    baselineStateGrants: 3_500_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.us.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.us.optionIndexes,
    seedTaxRatesOverride: SEED_TAX_RATES_1953.US,
    taxPolicyIds: {
      incomeTax: "us_federal_income_tax_rate",
      domesticCorporateTax: "us_federal_domestic_corporate_tax_rate",
      foreignCorporateTax: "us_federal_foreign_corporate_tax_rate",
      payrollTax: "us_federal_payroll_tax_rate",
      tariffs: "us_federal_tariff_rate",
      salesTax: "us_federal_sales_tax_rate",
    },
  },
  // ── United Kingdom FY1953/54 — Churchill / Attlee legacy ────────────────────
  // GDP £14.4B; NHS first full year (£570M); Korean War defence peak £1.6B;
  // food rationing ended 1954; gross WW2 debt ~£26B; Bank Rate 4% (raised Jul '52).
  {
    budgetId: "UK",
    countryId: "UK",
    fiscalYear: 1953,
    population: 50_600_000,
    gdp: 14_400_000_000, // £14.4B
    currencyCode: "GBP",
    economicFactors: {
      gdpGrowth: 4.0, // postwar recovery still running strong
      wageGrowth: 5.5,
      inflationRate: 3.0, // postwar inflation subsiding
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.5, // high income taxes (standard rate 47.5%)
      corporateProfits: 0.1,
      wagesAndSalaries: 0.5,
      importValue: 0.2,
      taxableSales: 0.35,
    },
    otherRevenue: 1_200_000_000,
    debt: {
      principal: 26_000_000_000, // massive WW2 debt (~180% GDP)
      interestRate: 0.04, // Bank Rate 4%
      ceiling: 28_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      health: 570_000_000, // NHS — new (1948) but growing fast
      education: 400_000_000,
      statePensions: 450_000_000,
      welfare: 300_000_000,
      defense: 1_600_000_000, // Korean War + NATO + global empire; 11% GDP
      transport: 150_000_000,
      other: 800_000_000,
    },
    baselineStateGrants: 250_000_000,
    // policyRevenueConfigs removed (spec §5.1b): the uk_nhs_funding
    // healthcareIncome line was orphaned by the political-legislation exclusion
    // sweep; UK revenue = authored rates × bases + revenue.lawRevenue.
    // (Supersedes dev's era-scaled NHS ladder — the OLD uk_nhs_funding type no
    // longer seeds on the 1953 preset, so its revenue config has no referent.)
    // Policy configs point at the era-correct 1953 table (spec §4.2a — this
    // block previously wired the MODERN config, a latent inconsistency).
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.uk.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.uk.optionIndexes,
    seedTaxRatesOverride: SEED_TAX_RATES_1953.UK,
    taxPolicyIds: {
      incomeTax: "uk_income_tax_rate",
      domesticCorporateTax: "uk_domestic_corporation_tax",
      foreignCorporateTax: "uk_foreign_corporation_tax",
      payrollTax: "uk_national_insurance",
      tariffs: "uk_excise_customs",
      salesTax: "uk_vat",
    },
  },
  // ── USSR FY1953 — Stalin era command economy ─────────────────────────────────
  // NMP ≈ ₽1.03T post-split (₽1.4T when Ukraine, Byelorussia and the Baltics were
  // still RU regions; Bergson/CIA basis); defence secret (~20% NMP); 5th Five-Year Plan;
  // Stalin died March 5, 1953; Beria/Khrushchev/Malenkov power struggle ensues.
  {
    budgetId: "RU",
    countryId: "RU",
    fiscalYear: 1953,
    // The regional seed (ruRegions1953) now models 148.5M across 14 regions:
    // Ukraine, Byelorussia and the Baltics were promoted out of RU into their
    // own countries and took 51.6M with them. The budget keeps the historic
    // ~6% under-count of the regional model (the regional values are authored
    // territorial extents, the budget is calibrated to Western estimates), so
    // it is scaled by the same 188/200.1 ratio the old pair carried:
    // 148.5M x 0.9395 = 139.5M.
    population: 139_500_000,
    // Was ₽1.4T when the regional rollup was ₽1,400,000M. The three departed
    // republics took ₽370,834M of that rollup (UKR 291,667 + BEL 50,000 +
    // BLT 29,167), leaving ₽1,029,166M. National GDP tracks the rollup exactly
    // for 1953, so reconcileStateGdp.ts is a no-op instead of rescaling every
    // RU region by 1.36.
    gdp: 1_029_166_000_000,
    currencyCode: "SUR",
    economicFactors: {
      gdpGrowth: 5.5, // Soviet official; real ~3.5–4%
      wageGrowth: 4.0,
      inflationRate: 0.5, // administered prices; near-zero open inflation
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    // Ruling #15 (political-legislation spec §4.2/§4.2a): re-authored to the
    // HISTORICAL fiscal budget (≈₽535B outlays / ≈₽540B revenue ≈ 38% of GDP,
    // turnover-tax anchored) — the prior seed spent ₽1,110B ≈ 79% of GDP, which
    // conflated the state's total economic footprint with the fiscal budget and
    // was structurally impossible under the era revenue cap. Command-economy
    // character lives in WHERE the budget goes (~30% to industry/infrastructure)
    // and in high baseline law levels, not in an impossible fiscal share.
    taxBaseRatios: {
      // §4.2a authored ratios: with the 75/25 corporate split these reproduce
      // the effective per-type factors 0.35/0.06/0.02/0.31/0.18/0.55 the RU
      // catalog's receipts table is calibrated on. (The previous ratios —
      // income 0.04 / corp 0.3 / wages 0.45 — would turn the authored slider
      // rates into an unrecognizable ≈₽527B mix.)
      taxableIncome: 0.35,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.31,
      importValue: 0.18,
      taxableSales: 0.55, // turnover-tax the dominant revenue source (31% rate)
    },
    // EVERY absolute rouble line below is the ruling-#15 whole-Union figure
    // multiplied by 0.735 (= ₽1,029,166M / ₽1,400,000M), the share of the
    // regional GDP rollup RU kept when Ukraine, Byelorussia and the Baltics
    // became their own countries. Scaling rather than re-authoring preserves
    // ruling #15's shape: outlays ≈38% of GDP, turnover-tax anchored, near
    // balance on day one. The republics' own budgets carry the other 26.5%.
    otherRevenue: 113_000_000_000, // state loans, price-equalization profits, state property
    debt: {
      principal: 15_000_000_000, // minimal external debt; domestic bonds only
      interestRate: 0.02,
      ceiling: 88_000_000_000, // ruling #15: raised for near-balance headroom
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      defense: 81_000_000_000, // Soviet Army + Korean commitment (fiscal line)
      education: 40_000_000_000,
      healthcare: 26_000_000_000,
      statePensions: 15_000_000_000, // pre-reform pensions: workers only, meager
      welfare: 18_000_000_000,
      infrastructure: 118_000_000_000, // industry + infrastructure investment (~30%)
      other: 51_000_000_000,
    },
    // Grants pool feeds the republic regional-budget phase and the ±15%
    // calibration goldens; policy configs adopt dev's era-authored 1953 table,
    // though the old su_* catalog is excluded at reset so rates come from the
    // override.
    baselineStateGrants: 44_000_000_000, // transfers to the union republics
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.su.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.su.optionIndexes,
    seedTaxRatesOverride: SEED_TAX_RATES_1953.RU,
    taxPolicyIds: {
      incomeTax: "su_individual_income_tax",
      domesticCorporateTax: "su_enterprise_levy",
      payrollTax: "su_social_insurance",
      tariffs: "su_customs_tariff",
      salesTax: "su_turnover_tax",
    },
  },
  // ── France FY1953 — Fourth Republic / Indochina War ─────────────────────────
  // GDP ≈ FFr 16,450B ($47B); Sécurité sociale (1945) maturing; Indochina War
  // consuming ~8.5% GDP on defence; inflation stabilising after postwar chaos.
  {
    budgetId: "FR",
    countryId: "FR",
    fiscalYear: 1953,
    population: 42_800_000,
    gdp: 16_450_000_000_000, // ≈ FFr 16,450B (old francs; 350 FFr/USD Bretton Woods)
    currencyCode: "FRF",
    economicFactors: {
      gdpGrowth: 3.5, // Trente Glorieuses steady growth
      wageGrowth: 5.0,
      inflationRate: 2.5, // stabilising after postwar spike
      tradeGrowth: 6.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.25,
      corporateProfits: 0.07,
      wagesAndSalaries: 0.42, // social charges base building
      importValue: 0.15,
      taxableSales: 0.45,
    },
    otherRevenue: 800_000_000_000,
    debt: {
      principal: 4_200_000_000_000, // WW2 + postwar reconstruction + Indochina
      interestRate: 0.06,
      ceiling: 6_000_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "A", // Indochina straining finances
    baselineSpendingByCategory: {
      socialSecurity: 1_800_000_000_000, // Sécurité sociale (1945) maturing rapidly
      healthcare: 600_000_000_000,
      education: 700_000_000_000,
      defense: 1_400_000_000_000, // Indochina War at peak; ~8.5% GDP
      infrastructure: 600_000_000_000,
      other: 750_000_000_000,
    },
    baselineStateGrants: 400_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.fr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.fr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "fr_income_tax",
      domesticCorporateTax: "fr_corporate_tax",
      payrollTax: "fr_social_charges",
      tariffs: "fr_customs_tariff",
      salesTax: "fr_vat",
    },
  },
  // ── Italy FY1953 — First Republic / Christian Democrats ─────────────────────
  // GDP ≈ $17B USD-equivalent (₤10.6T at 625 ITL/USD; refs #3498 USD-anchor).
  // 'Miracolo Economico' just starting; modest welfare vs. 1979; Marshall Plan
  // investment winding down but legacy strong. Amounts are USD-anchored (like
  // US/DE); currencyCode ITL is display-only.
  {
    budgetId: "IT",
    countryId: "IT",
    fiscalYear: 1953,
    population: 47_500_000,
    gdp: 17_000_000_000, // ≈ $17B (₤10.6T / 625)
    currencyCode: "ITL",
    economicFactors: {
      gdpGrowth: 6.5, // beginning of the Miracolo; rapid industrialisation
      wageGrowth: 5.0,
      inflationRate: 2.5,
      tradeGrowth: 8.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.22,
      corporateProfits: 0.06,
      wagesAndSalaries: 0.35,
      importValue: 0.18,
      taxableSales: 0.4,
    },
    otherRevenue: 560_000_000, // was ₤350B → $560M
    debt: {
      principal: 3_360_000_000, // ~20% GDP; relatively modest
      interestRate: 0.05,
      ceiling: 4_800_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "AA",
    baselineSpendingByCategory: {
      socialSecurity: 1_200_000_000, // INPS pensions + INAM health insurance
      healthcare: 320_000_000, // mutualist system; no SSN until 1978
      education: 560_000_000,
      defense: 480_000_000, // NATO member; modest
      infrastructure: 800_000_000, // Marshall Plan legacy reconstruction
      other: 640_000_000,
    },
    baselineStateGrants: 400_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.it.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.it.optionIndexes,
    taxPolicyIds: {
      incomeTax: "it_income_tax",
      domesticCorporateTax: "it_corporate_tax",
      payrollTax: "it_social_charges",
      tariffs: "it_customs_tariff",
      salesTax: "it_vat",
    },
  },
  // ── Spain FY1953 — Francoist autarky / US base treaty ───────────────────────
  // GDP ≈ ₧198B pesetas ($5B; ~40 pts/USD); autarky stagnation; INI state sector;
  // September 1953: US-Spain base agreements (Pact of Madrid) break isolation.
  {
    budgetId: "ES",
    countryId: "ES",
    fiscalYear: 1953,
    population: 28_200_000,
    gdp: 198_000_000_000, // ≈ ₧198B pesetas
    currencyCode: "ESP",
    economicFactors: {
      gdpGrowth: 2.0, // autarky constraining growth; below potential
      wageGrowth: 3.0,
      inflationRate: 4.0,
      tradeGrowth: 2.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.2, // weak fiscal capacity; autarky economy
      corporateProfits: 0.06,
      wagesAndSalaries: 0.3,
      importValue: 0.08, // minimal imports under autarky
      taxableSales: 0.4,
    },
    otherRevenue: 8_000_000_000,
    debt: {
      principal: 40_000_000_000, // ~20% GDP; isolated from international markets
      interestRate: 0.06,
      ceiling: 60_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB", // autarky + political isolation; poor credit access
    // Rescaled ~0.55x the original hand-authored total (fiscal-scale audit,
    // 2026-07-28): the lines below summed to ₧85B + ₧6B grants = ₧91B (47% of
    // GDP) against this config's own revenue side (₧37.1B / 18.7% of GDP,
    // undented further by a separate `es_customs_tariff` revenue gap — see
    // audit notes) — a ₧56.3B / 28.4%-of-GDP structural deficit from turn 1,
    // never checked against the revenue this same config produces. Financed
    // onto debt at the (uncapped past CCC) credit-rating interest schedule
    // (src/lib/budget/debt.ts), a 650-turn sandbox run compounded this to
    // 167.9% of GDP spending / 904% debt-to-GDP / CCC. Rescaling brings the
    // day-1 deficit to ~8% of GDP (₧15.8B) while preserving the category mix.
    // See BR's 1953 config for the same class of fix.
    baselineSpendingByCategory: {
      socialSecurity: 9_000_000_000, // Seguro de Vejez + Seguro de Enfermedad
      healthcare: 2_000_000_000,
      education: 4_500_000_000,
      defense: 14_000_000_000, // large army; Ejército del Aire
      infrastructure: 11_000_000_000, // INI autarky industrialisation
      other: 6_500_000_000,
    },
    baselineStateGrants: 3_500_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.es.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.es.optionIndexes,
    taxPolicyIds: {
      incomeTax: "es_income_tax",
      domesticCorporateTax: "es_corporate_tax",
      payrollTax: "es_social_charges",
      tariffs: "es_customs_tariff",
      salesTax: "es_consumption_tax",
    },
  },
  // ── Sweden FY1953 — the Swedish Model at full sail ───────────────────────────
  // GDP ≈ kr 36B (~$7B; 5.17 SEK/USD); LO-SAF Saltsjöbaden accord; strong export
  // surplus; folkpension universal (1913 → expanded 1946); neutral but well-armed.
  {
    budgetId: "SE",
    countryId: "SE",
    fiscalYear: 1953,
    population: 7_170_000,
    gdp: 36_000_000_000, // ≈ kr 36B
    currencyCode: "SEK",
    economicFactors: {
      gdpGrowth: 3.5,
      wageGrowth: 5.5,
      inflationRate: 2.5,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    // taxableIncome/wagesAndSalaries cut from 0.42/0.45 to 0.35/0.42 (fiscal-
    // scale audit, 2026-07-28, follow-up to the 2026-07-28 income/social-charges
    // bracket fix below). Sweden's wage economy was more formalized than
    // Finland's in 1953 (LO-SAF Saltsjöbaden, 1938) so it keeps a wider base
    // than FI's agrarian-economy 0.1/0.15, but 0.42/0.45 combined with even the
    // "standard" (not maximalist) income/social-charges brackets still landed
    // revenue at ~43-48% of GDP — above what a "folkhem under active
    // construction" (se_welfare_state's own 1953 framing, not yet mature)
    // economy realistically collected. Trimmed toward DE's Bismarckian
    // 0.3/0.4 formal-wage-economy ratios, giving Sweden credit for its more
    // advanced labor-market institutions without re-inflating to the original
    // footprint-scale figures (verified against getInitialNationalBudgetsForPreset
    // ("1953-default"): 43.5%/36.4%/+7.1%-of-GDP → ~38.2%/36.4%/+1.9%, a small
    // prudent surplus consistent with the AAA rating and "strong export
    // surplus" framing above, rather than an implausible >40%-of-GDP tax take).
    taxBaseRatios: {
      taxableIncome: 0.35,
      corporateProfits: 0.05,
      wagesAndSalaries: 0.42,
      importValue: 0.22,
      taxableSales: 0.4,
    },
    otherRevenue: 1_500_000_000,
    debt: {
      principal: 6_000_000_000, // ~17% GDP; well-managed
      interestRate: 0.04,
      ceiling: 9_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "AAA",
    baselineSpendingByCategory: {
      socialSecurity: 3_800_000_000, // folkpension + universal child allowance (1947)
      healthcare: 1_500_000_000, // county-council universal coverage
      education: 1_200_000_000,
      defense: 2_000_000_000, // neutral but large armed forces; ~5.5% GDP
      infrastructure: 1_500_000_000,
      other: 1_200_000_000,
    },
    baselineStateGrants: 1_800_000_000, // large transfers to municipalities
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.se.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.se.optionIndexes,
    taxPolicyIds: {
      incomeTax: "se_income_tax",
      domesticCorporateTax: "se_corporate_tax",
      payrollTax: "se_social_charges",
      tariffs: "se_customs_tariff",
      salesTax: "se_vat",
    },
  },
  // ── Turkey FY1953 — Menderes boom / NATO member ──────────────────────────────
  // GDP ≈ ₺24B (~$8.6B; 2.8 TRL/USD); joined NATO 1952; Menderes growth miracle
  // driven by US Marshall Plan successor aid + agricultural mechanisation.
  {
    budgetId: "TR",
    countryId: "TR",
    fiscalYear: 1953,
    population: 22_500_000,
    gdp: 24_000_000_000, // ≈ ₺24B lira
    currencyCode: "TRL",
    economicFactors: {
      gdpGrowth: 9.5, // Menderes boom (early 1950s); will collapse later in decade
      wageGrowth: 8.0,
      inflationRate: 4.5,
      tradeGrowth: 10.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.15,
      corporateProfits: 0.06,
      wagesAndSalaries: 0.28,
      importValue: 0.15,
      taxableSales: 0.38,
    },
    otherRevenue: 600_000_000,
    debt: {
      principal: 4_000_000_000, // ~17% GDP; moderate for NATO member
      interestRate: 0.08,
      ceiling: 6_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BBB",
    baselineSpendingByCategory: {
      defense: 2_500_000_000, // NATO; large military; Korean War contribution
      socialSecurity: 800_000_000,
      education: 900_000_000,
      healthcare: 500_000_000,
      infrastructure: 2_500_000_000, // Menderes era roads, dams, Atatürk Dam
      other: 700_000_000,
    },
    baselineStateGrants: 400_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.tr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.tr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "tr_income_tax",
      domesticCorporateTax: "tr_corporate_tax",
      payrollTax: "tr_social_charges",
      tariffs: "tr_customs_tariff",
      salesTax: "tr_sales_tax",
    },
  },
  // ── Greece FY1953 — Papagos reconstruction budget (drachmae) ────────────────
  // GDP ≈ ₯50B (game-abstract pre-revaluation scale); civil-war reconstruction
  // on American aid; the Markezinis devaluation (April 1953) resets the drachma
  // and opens the investment boom.
  {
    budgetId: "GR",
    countryId: "GR",
    fiscalYear: 1953,
    population: 7_600_000,
    gdp: 50_000_000_000, // ≈ ₯50B drachmae (game units)
    currencyCode: "GRD",
    economicFactors: {
      gdpGrowth: 7.0, // reconstruction boom after the 1953 devaluation
      wageGrowth: 6.0,
      inflationRate: 9.0, // post-devaluation pass-through, then stabilising
      tradeGrowth: 8.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.1, // very narrow base; agrarian smallholders
      corporateProfits: 0.05,
      wagesAndSalaries: 0.2,
      importValue: 0.18,
      taxableSales: 0.36,
    },
    otherRevenue: 2_500_000_000, // US aid counterpart funds; state monopolies
    debt: {
      principal: 12_000_000_000, // prewar debts in default/settlement; ~24% of GDP
      interestRate: 0.07,
      ceiling: 18_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB", // prewar default legacy, American backing
    baselineSpendingByCategory: {
      defense: 3_200_000_000, // large post-civil-war army; NATO member 1952
      socialSecurity: 1_600_000_000,
      education: 1_200_000_000,
      healthcare: 900_000_000,
      infrastructure: 2_600_000_000, // reconstruction of roads, ports, power (DEI 1950)
      other: 1_200_000_000,
    },
    baselineStateGrants: 800_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.gr.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.gr.optionIndexes,
    taxPolicyIds: {
      incomeTax: "gr_income_tax",
      domesticCorporateTax: "gr_corporate_tax",
      payrollTax: "gr_social_charges",
      tariffs: "gr_customs_tariff",
      salesTax: "gr_sales_tax",
    },
  },
  // ── Austria FY1953 — Raab-Kamitz occupied-republic budget (schilling) ────────
  // GDP ≈ öS 85B; four-power occupation (occupation costs still on the budget),
  // Marshall Plan counterpart funds financing reconstruction, the 1952 Kamitz
  // stabilisation just having broken the postwar inflation. No army until 1955.
  {
    budgetId: "AT",
    countryId: "AT",
    fiscalYear: 1953,
    population: 6_930_000,
    gdp: 85_000_000_000, // ≈ öS 85B schilling
    currencyCode: "ATS",
    economicFactors: {
      gdpGrowth: 3.0, // brief 1953 stabilisation pause before the mid-50s boom
      wageGrowth: 4.0, // wage-price agreements winding down
      inflationRate: 2.0, // Kamitz stabilisation after the 1951 spike
      tradeGrowth: 6.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.24,
      corporateProfits: 0.06,
      wagesAndSalaries: 0.36,
      importValue: 0.2,
      taxableSales: 0.42,
    },
    otherRevenue: 4_000_000_000, // ERP counterpart funds; state monopolies; nationalised-firm remittances
    debt: {
      principal: 12_000_000_000, // ~14% of GDP; prewar debts largely written down
      interestRate: 0.06,
      ceiling: 25_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BBB", // occupied but stabilising under American aid
    baselineSpendingByCategory: {
      defense: 800_000_000, // ~1% — no army (until 1955); gendarmerie + occupation costs
      socialSecurity: 9_000_000_000, // war pensions + the coming ASVG
      education: 4_500_000_000,
      healthcare: 3_500_000_000,
      infrastructure: 8_000_000_000, // ERP-funded power (Kaprun), rail, industry rebuild
      other: 5_000_000_000, // food subsidies, occupation costs, USIA losses
    },
    baselineStateGrants: 3_500_000_000, // Finanzausgleich to Länder and Gemeinden
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.at.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.at.optionIndexes,
    taxPolicyIds: {
      incomeTax: "at_income_tax",
      domesticCorporateTax: "at_corporate_tax",
      payrollTax: "at_social_charges",
      tariffs: "at_customs_tariff",
      salesTax: "at_sales_tax",
    },
  },
  // ── Finland FY1953 — postwar reparations-paid budget (old markka) ───────────
  // GDP ≈ mk 790B old markka (230 mk/USD; redenominated 100:1 in 1963). War
  // reparations to the USSR delivered in full (1952) — the metal industry they
  // built now exports east commercially; Karelian resettlement largely done; a
  // brief 1953 recession as the Korean boom deflates.
  {
    budgetId: "FI",
    countryId: "FI",
    fiscalYear: 1953,
    population: 4_150_000,
    gdp: 790_000_000_000, // ≈ mk 790B old markka
    currencyCode: "FIM",
    economicFactors: {
      gdpGrowth: 1.0, // the 1953 post-Korean-boom recession year
      wageGrowth: 4.0,
      inflationRate: 2.0, // stabilisation after the 1950-51 inflation wave
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    // taxableIncome/wagesAndSalaries cut from footprint-scale (0.26/0.38) to
    // fiscal-scale (fiscal-scale audit, 2026-07-28): 1953 Finland was still
    // substantially agrarian (urbanization crossed 50% only around 1970), so
    // the formal PAYE/payroll base subject to fi_income_tax (65%, "the
    // standard progressive schedule") and fi_social_charges (22%, "the
    // standard") was much narrower than a fully industrialized peer (DE 0.3/
    // 0.4, JP 0.25/0.38). At the old ratios this config alone produced $333.7B
    // revenue (42.2% of GDP) against $124B spend (15.7%) — a $200.8B/+25.4%-
    // of-GDP day-1 SURPLUS (verified against the sandbox `ahd_sim_grand53r3`
    // DB's turn-26 federalBudget doc), implausible for a small state that had
    // just finished delivering war reparations in kind (1952) and was in a
    // recession year. The cut brings revenue to ≈$211.5B (26.8% of GDP, in
    // line with Nordic-era tax/GDP ratios before the 1960s-80s welfare-state
    // tax expansion) against the unchanged $124B spend — a small, defensible
    // ≈11% of GDP surplus, not a >25% one.
    taxBaseRatios: {
      taxableIncome: 0.1,
      corporateProfits: 0.06,
      wagesAndSalaries: 0.15,
      importValue: 0.2,
      taxableSales: 0.4,
    },
    otherRevenue: 30_000_000_000, // Alko monopoly, state forests, state-company remittances
    debt: {
      principal: 90_000_000_000, // ~11% of GDP; reparations paid in kind, not borrowed
      interestRate: 0.06,
      ceiling: 200_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BBB",
    baselineSpendingByCategory: {
      defense: 10_000_000_000, // Paris-treaty-capped conscript force
      socialSecurity: 28_000_000_000, // war pensions + child allowances (1948)
      education: 18_000_000_000,
      healthcare: 10_000_000_000,
      // Bumped 26B → 32B (fiscal-scale audit follow-up, 2026-07-28): the
      // Oulujoki hydro scheme (Pyhäkoski/Montta) and the ~400,000-person
      // Karelian resettlement land-settlement program (asutustoiminta) were
      // BOTH large, concurrently-running state capital programs in 1953, not
      // sequential — 26B understated their combined scale.
      infrastructure: 32_000_000_000, // resettlement roads, hydro dams (Oulujoki), rail
      other: 18_000_000_000, // farm supports, Karelian compensation payments
    },
    baselineStateGrants: 14_000_000_000, // municipal grants
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.fi.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.fi.optionIndexes,
    taxPolicyIds: {
      incomeTax: "fi_income_tax",
      domesticCorporateTax: "fi_corporate_tax",
      payrollTax: "fi_social_charges",
      tariffs: "fi_customs_tariff",
      salesTax: "fi_sales_tax",
    },
  },
  // ── West Germany FY1953 — Adenauer / Wirtschaftswunder ──────────────────────
  // GDP ≈ DM 138B (~$33B; 4.2 DEM/USD Bretton Woods); London Debt Agreement signed
  // Feb 1953; no Bundeswehr yet (1955); Economic Miracle driven by exports + US aid.
  // currencyCode EUR = game proxy for DM (display layer shows "Deutsche Mark").
  {
    budgetId: "DE",
    countryId: "DE",
    fiscalYear: 1953,
    population: 50_000_000, // West Germany only
    gdp: 138_000_000_000, // DM 138B; game unit EUR = 1:1 DM proxy
    currencyCode: "EUR",
    economicFactors: {
      gdpGrowth: 8.5, // Wirtschaftswunder peak
      wageGrowth: 9.0,
      inflationRate: -0.2, // 1953: mild deflation (DM very stable)
      tradeGrowth: 15.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.3,
      corporateProfits: 0.07,
      wagesAndSalaries: 0.4, // Bismarckian social insurance
      importValue: 0.16,
      taxableSales: 0.45,
    },
    otherRevenue: 4_000_000_000,
    debt: {
      principal: 10_000_000_000, // post-London Debt Agreement; very low
      interestRate: 0.035,
      ceiling: 18_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "AA", // London Debt Agreement (Feb 1953) restored creditworthiness
    // Keys "welfare"/"transport" (not "socialSecurity"/"infrastructure") — match
    // deLegislationTypes.ts's actual budgetCategory strings for these lines (see
    // EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY.DE above). The old names never
    // matched any DE law, so these two lines — the largest in the baseline —
    // silently fell through to the modern per-domain catalog's much smaller
    // policy-derived costs.
    baselineSpendingByCategory: {
      welfare: 14_000_000_000, // Bismarckian pensions + unemployment insurance
      healthcare: 6_000_000_000, // GKV statutory insurance
      education: 3_000_000_000, // Länder pay most
      defense: 3_000_000_000, // occupation costs; no Bundeswehr until 1955
      transport: 8_000_000_000, // Wirtschaftswunder reconstruction (rail/roads)
      other: 9_000_000_000,
    },
    baselineStateGrants: 5_000_000_000, // transfers to Länder (Länderfinanzausgleich)
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.de.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.de.optionIndexes,
    taxPolicyIds: {
      incomeTax: "de_income_tax_rate",
      domesticCorporateTax: "de_domestic_corporate_tax_rate",
      foreignCorporateTax: "de_foreign_corporate_tax_rate",
      payrollTax: "de_payroll_social_insurance",
      tariffs: "de_customs_tariff_rate",
      salesTax: "de_vat_rate",
      solidaritySurcharge: "de_solidarity_surcharge",
    },
  },
  // ── Japan FY1953 — post-Occupation recovery / Korean War boom ───────────────
  // GDP ≈ $25.8B USD-equivalent (¥9.3T at 360 JPY/USD Bretton Woods; refs #3498
  // USD-anchor). Occupation ended Apr 1952; Korean War procurement boosted
  // industry; Article 9 → Self-Defense Forces tiny (~1% GNP). Amounts below are
  // USD-anchored (like US/DE); currencyCode JPY is display-only.
  {
    budgetId: "JP",
    countryId: "JP",
    fiscalYear: 1953,
    population: 86_600_000,
    gdp: 25_800_000_000, // ≈ $25.8B (¥9.3T / 360)
    currencyCode: "JPY",
    economicFactors: {
      gdpGrowth: 9.0, // Korean War boom + reconstruction
      wageGrowth: 10.0,
      inflationRate: 6.5, // postwar inflation slowly subsiding
      tradeGrowth: 20.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.25,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.38,
      importValue: 0.12,
      taxableSales: 0.35,
    },
    otherRevenue: 556_000_000, // was ¥200B → $556M
    debt: {
      principal: 4_170_000_000, // ~16% GDP; recovery-era
      interestRate: 0.06,
      ceiling: 6_940_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB", // recently independent; below investment-grade internationally
    baselineSpendingByCategory: {
      // Key is "social" (not "socialSecurity") — matches jp_family_policy /
      // jp_pension / jp_gender_equality / jp_work_culture_reform's actual
      // legislationType.budgetCategory. The old "socialSecurity" key never
      // matched any JP law's category, so this line was a phantom that never
      // reached BASELINE_OVERRIDE_CATEGORIES or the runtime spend (fiscal
      // audit F-11).
      social: 556_000_000, // minimal; National Pension not until 1961
      healthcare: 500_000_000, // national health insurance being built
      education: 972_000_000, // big priority; Showa era mass education
      defense: 250_000_000, // SDF very small; Article 9; ~1% GNP
      // Key is "infrastructure" (not "publicWorks") — matches
      // jp_rail_transport / jp_disaster_preparedness / jp_regional_transport /
      // jp_regional_utilities's actual budgetCategory. The old "publicWorks"
      // key never matched, so this reconstruction-infrastructure line was
      // invisible to BOTH the runtime spend AND resolveInfraEnvelope's
      // `baselineSpendingByCategory.infrastructure` read (fiscal audit F-11).
      infrastructure: 1_670_000_000, // massive reconstruction infrastructure
      other: 1_670_000_000,
    },
    baselineStateGrants: 1_110_000_000, // 地方交付税 (Local Allocation Tax) — see GRANT_OVERRIDE_COUNTRIES
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.jp.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.jp.optionIndexes,
    taxPolicyIds: {
      incomeTax: "jp_income_tax_rate",
      domesticCorporateTax: "jp_domestic_corporation_tax",
      foreignCorporateTax: "jp_foreign_corporation_tax",
      payrollTax: "jp_social_insurance",
      tariffs: "jp_customs_tariff",
      salesTax: "jp_consumption_tax",
    },
  },
  // ── China FY1953 — People's Republic / First Five-Year Plan ─────────────────
  // GDP ≈ $33.3B USD-equivalent (¥CNY 82B at official ~2.46 CNY/USD; refs #3498
  // USD-anchor). Korean War armistice July 1953; 1st FYP started 1953 with Soviet
  // technical aid; mass land reform completed; PLA huge. Amounts are USD-anchored
  // (like US/DE); currencyCode CNY is display-only.
  {
    budgetId: "CN",
    countryId: "CN",
    fiscalYear: 1953,
    population: 588_000_000,
    gdp: 33_300_000_000, // ≈ $33.3B (¥CNY 82B / 2.46)
    currencyCode: "CNY",
    economicFactors: {
      gdpGrowth: 15.0, // Soviet-assisted industrialisation + land reform gains
      wageGrowth: 8.0,
      inflationRate: 3.5,
      tradeGrowth: 15.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.02, // virtually no individual income tax yet
      corporateProfits: 0.04,
      wagesAndSalaries: 0.4,
      importValue: 0.1,
      taxableSales: 0.45,
    },
    otherRevenue: 2_030_000_000, // was ¥5B → ~$2.03B
    debt: {
      principal: 3_250_000_000, // Soviet loans (interest-bearing)
      interestRate: 0.03,
      ceiling: 8_130_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB",
    baselineSpendingByCategory: {
      defense: 4_880_000_000, // large PLA; Korean War just ending
      education: 1_630_000_000, // mass literacy campaign
      // 1st-FYP capital construction ramped over 1953-57 toward its ¥76.4B
      // five-year total; 1953 (the plan's first year, still standing up
      // Soviet-aided project sites) sits at the low end of that ramp, not the
      // plan's later peak run-rate — cut from 7.32B (22% of GDP, the full-plan
      // average share) to 9% of GDP, in line with commonly-cited PRC
      // national-budget capital-construction shares for the plan's opening
      // year (fiscal audit F-11; the original 22% figure produced a 57%-of-GDP
      // total budget once this category was correctly pinned instead of
      // silently discarded — see EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY.CN).
      infrastructure: 3_000_000_000,
      socialSecurity: 810_000_000,
      // Key is "health" (not "healthcare") — matches cn_medical_insurance /
      // cn_elder_care / cn_public_health / cn_mental_health's actual
      // legislationType.budgetCategory. The old "healthcare" key never
      // matched, so this line fell back to the (much thinner) raw era-catalog
      // sum inside deriveEnactedLaws' override rescale (fiscal audit F-11).
      health: 810_000_000,
      other: 2_030_000_000,
    },
    baselineStateGrants: 1_630_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.cn.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.cn.optionIndexes,
    taxPolicyIds: {
      incomeTax: "cn_individual_income_tax",
      domesticCorporateTax: "cn_enterprise_income_tax",
      payrollTax: "cn_social_insurance_contribution",
      tariffs: "cn_customs_tariff",
      salesTax: "cn_value_added_tax",
      landValueAddedTax: "cn_land_value_added_tax",
      urbanMaintenanceTax: "cn_urban_maintenance_construction_tax",
      stampDuty: "cn_stamp_duty",
    },
  },
  // ── Brazil FY1953 — Vargas era / ISI / Petrobras ────────────────────────────
  // GDP ≈ Cr$ 330B ($18B; ~18 cruzeiros/USD); Vargas 2nd term (suicide Aug 1954);
  // Petrobras founded Oct 1953; ISI: Volta Redonda steel + BNDES investment.
  // currencyCode BRL = game proxy for cruzeiro (display layer handles name).
  {
    budgetId: "BR",
    countryId: "BR",
    fiscalYear: 1953,
    population: 57_000_000,
    gdp: 330_000_000_000, // ≈ Cr$ 330B cruzeiros; game unit BRL = cruzeiro proxy
    currencyCode: "BRL",
    economicFactors: {
      gdpGrowth: 4.5, // Vargas-era ISI growth
      wageGrowth: 15.0,
      inflationRate: 8.0, // Vargas-era chronic inflation, but authored with headroom
      // below MAX_INFLATION (15). Seeded at 12.0 it drifted to 14.4 by t2 and
      // pinned to the clamp by t3, where it stayed for the rest of the run — a
      // clamped series is held, not settling, so the whole monetary response
      // becomes unreadable. Same treatment the 1991 table already documents for
      // countries whose real inflation exceeds the model ceiling.
      tradeGrowth: 3.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.15,
      corporateProfits: 0.06,
      wagesAndSalaries: 0.3,
      importValue: 0.12,
      taxableSales: 0.35,
    },
    otherRevenue: 20_000_000_000,
    debt: {
      principal: 50_000_000_000, // ~15% GDP
      interestRate: 0.1,
      ceiling: 80_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB",
    // Rescaled to ~half the original hand-authored total (fiscal-scale audit,
    // 2026-07-28): the lines below summed to Cr$163B + Cr$20B grants = Cr$183B
    // (57% of GDP) against this config's OWN revenue side (taxRateOverrides
    // below, documented at "~21% of GDP" and landing at Cr$71B/21.5%) — a
    // Cr$117B / 35.5%-of-GDP structural deficit from turn 1, authored without
    // ever being checked against the revenue this same config produces. No
    // real government (fictional or historical) runs that every year; financed
    // onto debt at the credit-rating interest schedule (src/lib/budget/debt.ts,
    // uncapped past CCC), a 650-turn sandbox run compounded it to 185% of GDP
    // spending / 1009% debt-to-GDP / CCC. Halving brings the day-1 deficit to
    // ~7.7% of GDP (Cr$25.5B) — a real but sane Korean-War-era gap — while
    // preserving the category mix and flavour. See ES's 1953 config for the
    // same class of fix.
    //
    // Every key below is now also booked by a real spending law
    // (brLegislationTypes.ts) and pinned to this exact figure at the default
    // option via EXTRA_OVERRIDE_CATEGORIES_BY_COUNTRY.BR / GRANT_OVERRIDE_COUNTRIES
    // (this file) — BR is no longer relying solely on the baseline fallback.
    baselineSpendingByCategory: {
      socialSecurity: 12_500_000_000,
      healthcare: 4_000_000_000,
      education: 10_000_000_000,
      defense: 7_500_000_000,
      infrastructure: 30_000_000_000, // ISI: Volta Redonda, Petrobras, BNDES projects
      other: 17_500_000_000,
    },
    baselineStateGrants: 10_000_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.br.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.br.optionIndexes,
    // Legislation-derived (brLegislationTypes.ts, added with the BR legislation
    // module): each dial's default policyOptionOverrides index (below) is
    // authored at the SAME rate the old taxRateOverrides stopgap used to hard-
    // code (income 18%, corporate 18%, IAP/payroll 20%, IVC/sales 10%, tariff
    // 18%; foreignCorporateTax has no separate bill and mirrors domestic per
    // deriveTaxRates's day-one-parity fallback), so revenue.total is unchanged
    // from the pre-legislation stopgap — see brLegislationTypes.test.ts.
    taxPolicyIds: {
      incomeTax: "br_income_tax_rate",
      domesticCorporateTax: "br_corporate_tax",
      payrollTax: "br_iap_contribution",
      tariffs: "br_customs_tariff",
      salesTax: "br_ivc",
    },
  },
  // ── Ireland FY1953 — emigration crisis / agricultural economy ───────────────
  // GDP ≈ £IR 340M ($953M; at par with GBP = $2.80); peak emigration era (net
  // outflow ~40k/yr); Costello coalition → de Valera; overwhelmingly agrarian;
  // no industrial policy yet (Whitaker 1958 still 5 years away).
  // IEP at Bretton Woods GBP par (seeded with hardPeg).
  {
    budgetId: "IE",
    countryId: "IE",
    fiscalYear: 1953,
    population: 2_960_000, // and falling — emigration reducing it year on year
    gdp: 340_000_000, // £IR 340M
    currencyCode: "IEP",
    economicFactors: {
      gdpGrowth: 1.5, // stagnation; emigration absorbing surplus labour
      wageGrowth: 3.0,
      inflationRate: 2.5,
      tradeGrowth: 2.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.35,
      corporateProfits: 0.08,
      wagesAndSalaries: 0.4,
      importValue: 0.3, // highly trade-dependent; large import share
      taxableSales: 0.35,
    },
    otherRevenue: 12_000_000,
    debt: {
      principal: 120_000_000, // ~35% GDP
      interestRate: 0.04,
      ceiling: 150_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      health: 18_000_000,
      education: 16_000_000,
      socialProtection: 25_000_000,
      housing: 12_000_000,
      transport: 8_000_000,
      defense: 6_000_000, // Defence Forces; small; neutral
      other: 15_000_000,
    },
    baselineStateGrants: 8_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.ie.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.ie.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ie_income_tax_rate",
      domesticCorporateTax: "ie_corporate_tax_rate",
      payrollTax: "ie_prsi",
      salesTax: "ie_vat_rate",
    },
  },
  // ── Nigeria FY1953 — British colonial administration ────────────────────────
  // Colonial Nigeria under the Crown; Eastern/Western/Northern Regions established;
  // Richards Constitution (1946) → Macpherson (1951) → Lyttleton (1954 federal);
  // groundnuts, cocoa, palm oil exports. GDP ≈ $3.4B USD-equivalent (£1.2B WAP at
  // $2.80/£; refs #3498 USD-anchor). Currency was the West African pound (pegged
  // 1:1 to GBP) — the naira did not exist until 1973. Amounts are USD-anchored
  // (like US/DE); currencyCode NGN is display-only.
  {
    budgetId: "NG",
    countryId: "NG",
    fiscalYear: 1953,
    population: 30_000_000,
    gdp: 3_400_000_000, // ≈ $3.4B (£1.2B WAP × $2.80)
    currencyCode: "NGN",
    economicFactors: {
      gdpGrowth: 3.5, // moderate colonial growth; commodity export dependence
      wageGrowth: 3.0,
      inflationRate: 3.0,
      tradeGrowth: 5.0,
      lastUpdated: new Date(0),
    },
    taxBaseRatios: {
      taxableIncome: 0.02,
      corporateProfits: 0.03,
      wagesAndSalaries: 0.18,
      importValue: 0.22, // colonial: import tariffs the main revenue source
      taxableSales: 0.2,
    },
    otherRevenue: 196_000_000, // export duties on groundnuts/cocoa/palm oil
    debt: {
      principal: 364_000_000,
      interestRate: 0.05,
      ceiling: 728_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "BB",
    baselineSpendingByCategory: {
      socialSecurity: 56_000_000,
      healthcare: 84_000_000,
      education: 224_000_000, // colonial priority; English-medium schools
      defense: 112_000_000, // Royal West African Frontier Force
      infrastructure: 280_000_000, // railways + colonial port infrastructure
      other: 196_000_000,
    },
    baselineStateGrants: 140_000_000, // grants to regional governments
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.ng.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.ng.optionIndexes,
    taxPolicyIds: {
      incomeTax: "ng_personal_income_tax",
      domesticCorporateTax: "ng_companies_income_tax",
      payrollTax: "ng_paye",
      salesTax: "ng_vat_rate",
    },
  },
  // ── East Germany FY1953 — GDR / SED Stalinist plan economy ─────────────────
  // NMP ≈ DDM 50B; June 17, 1953 workers' uprising crushed by Soviet tanks;
  // reparations to USSR depressing capital formation; population fleeing West.
  {
    budgetId: "DD",
    countryId: "DD",
    fiscalYear: 1953,
    population: 18_400_000,
    gdp: 50_000_000_000, // ≈ DDM 50B (NMP basis; very uncertain)
    currencyCode: "DDM",
    economicFactors: {
      gdpGrowth: 3.0, // recovering but disrupted by June uprising + Soviet reparations
      wageGrowth: 2.5,
      inflationRate: 0.5, // administered prices
      tradeGrowth: 2.0,
      lastUpdated: new Date(0),
    },
    // Political-legislation calibration (RU-parity §4.2a discipline): the
    // authored slider rates × these ratios reproduce the DD catalog's receipts
    // (product levy the anchor). Fiscal share held to ~35-40% of NMP — the
    // prior ~90% authored spend conflated the state's total economic footprint
    // with the fiscal budget (same structural fix as RU ruling #15).
    taxBaseRatios: {
      taxableIncome: 0.35,
      corporateProfits: 0.08, // VEB remittance base (75/25 domestic/foreign split)
      wagesAndSalaries: 0.31,
      importValue: 0.18,
      taxableSales: 0.55, // product-levy base — the dominant revenue source (28% rate)
    },
    otherRevenue: 4_500_000_000, // direct VEB remittances + state property income
    debt: {
      principal: 3_000_000_000, // Soviet reparations treated as debt
      interestRate: 0.04,
      ceiling: 10_000_000_000,
      ceilingLastRaisedYear: 1953,
    },
    creditRating: "A",
    baselineSpendingByCategory: {
      defense: 2_500_000_000, // KVP (precursor to the army)
      education: 2_200_000_000,
      healthcare: 1_400_000_000,
      statePensions: 1_500_000_000, // unified social insurance pensions
      welfare: 1_200_000_000,
      infrastructure: 4_000_000_000, // plan investment + reconstruction
      other: 3_000_000_000,
    },
    // Grants stay at the SP7-calibrated scale (M 1.5B completes the 17.3B
    // outlay anchor the DD calibration goldens assert); policy configs adopt
    // dev's era-authored 1953 table, though the old dd_* catalog is excluded
    // at reset so rates come from the override.
    baselineStateGrants: 1_500_000_000,
    policyDefaults: COUNTRY_POLICY_CONFIGS_1953.dd.defaults,
    policyOptionOverrides: COUNTRY_POLICY_CONFIGS_1953.dd.optionIndexes,
    seedTaxRatesOverride: SEED_TAX_RATES_1953.DD,
    taxPolicyIds: {
      incomeTax: "dd_income_tax",
      domesticCorporateTax: "dd_enterprise_levy",
      payrollTax: "dd_social_insurance",
      tariffs: "dd_foreign_trade",
      salesTax: "dd_product_tax",
    },
  },
  // ── Hungary FY1953 — Stalinist plan economy ─────────────────────────────────
  // NMP ≈ Ft 100B; forcible collectivisation, show trials; "New Course" announced
  // June 1953 after Stalin's death. Previously a hand-authored footprint-scale
  // block (corp 0.62 / sales 1.15 / other 21% → 107% GDP revenue); now routed
  // through makeEasternBlocBudget1953 so the fiscal-scale bases apply uniformly.
  ...makeEasternBlocBudget1953(
    "HU",
    9_500_000,
    100_000_000_000,
    "HUF",
    { gdpGrowth: 3.5, inflationRate: 3.0 },
    15_000_000_000,
    "A"
  ), // heavy industrialisation (Diósgyőr steel / new socialist towns)
  ...makeEasternBlocBudget1953(
    "PL",
    25_500_000,
    300_000_000_000,
    "PLZ",
    { gdpGrowth: 4.0, inflationRate: 2.0 },
    20_000_000_000,
    "BBB"
  ), // Bierut era; 6-Year Plan (1950–55); Nowa Huta steel town
  ...makeEasternBlocBudget1953(
    "RO",
    16_600_000,
    80_000_000_000,
    "ROL",
    { gdpGrowth: 3.5, inflationRate: 2.0 },
    8_000_000_000,
    "BB"
  ), // Dej Stalinist era; oil exports to USSR
  ...makeEasternBlocBudget1953(
    "YU",
    16_900_000,
    100_000_000_000,
    "YUD",
    { gdpGrowth: 5.0, inflationRate: 5.0 },
    15_000_000_000,
    "BB"
  ), // Tito; expelled Cominform 1948; US aid 1950; workers' self-management
  ...makeEasternBlocBudget1953(
    "BG",
    7_300_000,
    40_000_000_000,
    "BGL",
    { gdpGrowth: 4.0, inflationRate: 1.5 },
    4_000_000_000,
    "A"
  ), // Chervenkov era; most Stalinist of the bloc
  // The three western union republics now run their own budgets. Population and
  // GDP are the sums of their authored regions on the RSFSR ruble basis, so
  // reconcileStateGdp sees a rollup that matches the national figure.
  ...makeEasternBlocBudget1953(
    "BLR",
    7_700_000,
    50_000_000_000,
    "SUR",
    { gdpGrowth: 5.0, inflationRate: 0.5 },
    2_000_000_000,
    "AA"
  ), // Byelorussian SSR; reconstruction economy, MAZ and Soligorsk just standing up
  ...makeEasternBlocBudget1953(
    "UKR",
    41_000_000,
    291_667_000_000,
    "SUR",
    { gdpGrowth: 5.5, inflationRate: 0.5 },
    9_000_000_000,
    "AA"
  ), // Ukrainian SSR; the Union's second economy, Donbas coal and Dnieper steel
  ...makeEasternBlocBudget1953(
    "CS",
    12_400_000,
    200_000_000_000,
    "CSK",
    { gdpGrowth: 4.5, inflationRate: 1.5 },
    12_000_000_000,
    "A"
  ), // Zápotocký era; most industrialised bloc state; show trials (Slánský 1952)
  ...makeEasternBlocBudget1953(
    "BAL",
    2_900_000,
    29_167_000_000,
    "SUR",
    { gdpGrowth: 4.5, inflationRate: 0.5 },
    1_500_000_000,
    "AA"
  ), // Baltic SSRs; highest living standards in the Union, lowest consent for it
];

/**
 * Returns the preset-appropriate national-budget seed configs. Falls back
 * to the 2019-era bundle for unknown presets.
 */
export function getNationalBudgetSeedConfigsForPreset(preset: string): NationalBudgetSeedConfig[] {
  if (preset === "1953-default") return NATIONAL_BUDGET_SEED_CONFIGS_1953;
  if (preset === "1979-default") return NATIONAL_BUDGET_SEED_CONFIGS_1979;
  if (preset === "1991-default") return NATIONAL_BUDGET_SEED_CONFIGS_1991;
  if (preset === "1999-default") return NATIONAL_BUDGET_SEED_CONFIGS_1999;
  if (preset === "2007-default") return NATIONAL_BUDGET_SEED_CONFIGS_2007;
  if (preset === "2023-default") return NATIONAL_BUDGET_SEED_CONFIGS_2023;
  return NATIONAL_BUDGET_SEED_CONFIGS;
}

/**
 * Builds the federal-budget seed array for the given preset.
 */
export function getInitialNationalBudgetsForPreset(preset: string): SupportedNationalBudget[] {
  const budgets = getNationalBudgetSeedConfigsForPreset(preset).map(buildNationalBudgetSeed);
  // Fail loud on the zero-revenue pathology (BR's class of bug): a country with
  // real tax bases but an all-zero core rate vector means its taxPolicyIds
  // referenced legislation types that were never seeded, so it collects nothing
  // and runs a permanent placeholder-only deficit. Add taxRateOverrides or a
  // legislation module rather than shipping a country that levies no taxes.
  for (const b of budgets) {
    const hasBase =
      b.taxBases.taxableIncome > 0 ||
      b.taxBases.wagesAndSalaries > 0 ||
      b.taxBases.taxableSales > 0;
    const allCoreRatesZero =
      !b.taxRates.incomeTax &&
      !b.taxRates.domesticCorporateTax &&
      !b.taxRates.payrollTax &&
      !b.taxRates.tariffs &&
      !b.taxRates.salesTax;
    if (hasBase && allCoreRatesZero) {
      throw new Error(
        `Seed preset "${preset}": ${b.countryId} has non-zero tax bases but an ` +
          `all-zero tax-rate vector — its taxPolicyIds likely reference unseeded ` +
          `legislation types. Add taxRateOverrides or a legislation module.`
      );
    }
  }
  return budgets;
}

export const initialNationalBudgets: SupportedNationalBudget[] =
  NATIONAL_BUDGET_SEED_CONFIGS.map(buildNationalBudgetSeed);

export const initialFederalBudget = initialNationalBudgets.find(
  (budget) => budget.countryId === "US"
) as SupportedNationalBudget;

export const initialUkBudget = initialNationalBudgets.find(
  (budget) => budget.countryId === "UK"
) as SupportedNationalBudget;

type StateBudgetSeedInput = {
  id: string;
  population: number;
  gdp: number;
  countryId?: string;
};

export interface CountryOwnedSeedData {
  corporation: Omit<Corporation, "_id"> & { _id: ObjectId };
  sectors: Array<Omit<CorporateSector, "_id"> & { _id: ObjectId }>;
}

const UK_PUBLIC_CORPORATION_ID = new ObjectId("700000000000000000000001");
const UK_PUBLIC_PLACEHOLDER_CHARACTER_ID = new ObjectId("700000000000000000000002");
const UK_PUBLIC_PLACEHOLDER_USER_ID = new ObjectId("700000000000000000000003");
const US_PUBLIC_CORPORATION_ID = new ObjectId("700000000000000000000011");
const US_PUBLIC_PLACEHOLDER_CHARACTER_ID = new ObjectId("700000000000000000000012");
const US_PUBLIC_PLACEHOLDER_USER_ID = new ObjectId("700000000000000000000013");
const JP_PUBLIC_CORPORATION_ID = new ObjectId("700000000000000000000021");
const JP_PUBLIC_PLACEHOLDER_CHARACTER_ID = new ObjectId("700000000000000000000022");
const JP_PUBLIC_PLACEHOLDER_USER_ID = new ObjectId("700000000000000000000023");
const JP_PUBLIC_CORPORATION_SEQUENTIAL_ID = 900_003;

/** Reserved sequential IDs for country-owned corporations (stable /corporation/{id} URLs). */
const US_PUBLIC_CORPORATION_SEQUENTIAL_ID = 900_001;
const UK_PUBLIC_CORPORATION_SEQUENTIAL_ID = 900_002;

// ── USSR (RU) state enterprise ────────────────────────────────────────────
// The USSR is a command economy with no player corporations, so unless the
// state owns producing sectors it is an economic ghost (0 corps / 0 sectors →
// no commodity supply, since only OWNED sectors count in commodityPriceTurn).
// Seed a single primary National Corporation ("Gosplan") that OWNS producing
// sectors across the commanding heights in every Soviet region. Continues the
// 700…x1/x2/x3 issuer id sequence (US 11, JP 21, DE 31, IE 41, BR 51, CN 61,
// NG 71 → RU 81) and the 900_00N sequentialId sequence (→ 900_009).
const RU_PUBLIC_CORPORATION_ID = new ObjectId("700000000000000000000081");
const RU_PUBLIC_PLACEHOLDER_CHARACTER_ID = new ObjectId("700000000000000000000082");
const RU_PUBLIC_PLACEHOLDER_USER_ID = new ObjectId("700000000000000000000083");
const RU_PUBLIC_CORPORATION_SEQUENTIAL_ID = 900_009;

/**
 * Command Economy v2 (P0): stable ObjectIds for the per-sector SOE corporations.
 * When `commandEconomyEnabled` is on, a command country's producing sectors are
 * owned by ONE SOE per commanding-height sector rather than a single National
 * Corp. Ids are derived deterministically from a per-country base so reseeds
 * are idempotent.
 */
// Legacy SOEs used `700…000` + 3 hex digits (suffix < 0x1000). Ticket #1014
// widened every Eastern-bloc country to one SOE per CorporationType (17×8 =
// 0x88 headroom → 0x100 bands). Placing those bands at 0x100–0xc00 collided
// with live legacy ObjectIds (BG/RO/YU overwrote RU/CN/DD). New layout uses a
// 4-hex suffix under a 20-char prefix, starting at 0x1000 — disjoint from every
// legacy 3-digit SOE id. Slot index is the stable CORPORATION_TYPES ordinal.
const SOE_ID_BASE_BY_COUNTRY: Partial<Record<CountryId, number>> = {
  UKR: 0x1000,
  BLR: 0x1100,
  BAL: 0x1200,
  RU: 0x1300,
  CN: 0x1400,
  DD: 0x1500,
  PL: 0x1600,
  HU: 0x1700,
  CS: 0x1800,
  BG: 0x1900,
  RO: 0x1a00,
  YU: 0x1b00,
};
const SOE_SEQUENTIAL_BASE_BY_COUNTRY: Partial<Record<CountryId, number>> = {
  UKR: 901_000,
  BLR: 901_100,
  BAL: 901_200,
  RU: 900_100,
  CN: 900_200,
  DD: 900_300,
  PL: 900_400,
  HU: 900_500,
  CS: 900_600,
  BG: 900_700,
  RO: 900_800,
  YU: 900_900,
};
function soeObjectId(suffix: number): ObjectId {
  return new ObjectId("70000000000000000000" + suffix.toString(16).padStart(4, "0"));
}

/**
 * Sectors the Soviet state directly operates — the "commanding heights" of a
 * planned economy. These are the RU National Corporation's owned sectors so the
 * USSR produces commodities each turn even with no player corporations.
 */
const RU_COMMANDING_HEIGHTS: CorporationType[] = [
  "manufacturing",
  "energy",
  "extraction",
  "agriculture",
  "defense",
  "chemical_industries",
];

/**
 * Command Economy v2: build the per-sector state-owned-enterprise corp entries
 * for a command country — one SOE corporation per commanding-height sector (from
 * {@link commandEconomySoeSectors}), each OWNING that sector's producing
 * `corporateSectors` across every supplied region and carrying the
 * {@link SoeState} plan-fulfillment overlay. Shared by RU and CN so both command
 * economies split identically: deterministic per-country SOE ids/sequentials
 * (from the `SOE_*_BASE_BY_COUNTRY` maps), on-plan seed output, a vacant
 * (NPP-run) director seat, and thin soft-budget margins. The CALLER keeps the
 * country's bare sovereign issuer as the primary National Corporation; these
 * SOEs are the non-primary producing arms.
 */
function buildCommandSoeCorpEntries(params: {
  countryId: CountryId;
  states: StateBudgetSeedInput[];
  preset: string;
  now: Date;
  /** Prefixes the enterprise name, e.g. "Soviet" / "Chinese". */
  namePrefix: string;
  /** Closes the description sentence, e.g. "Soviet planned economy". */
  polityDescriptor: string;
  headquartersState: string;
  currencyCode: ActiveCurrencyCode;
  legalStructure: LegalStructureId | undefined;
}): CountryOwnedSeedData[] {
  const {
    countryId,
    states,
    preset,
    now,
    namePrefix,
    polityDescriptor,
    headquartersState,
    currencyCode,
    legalStructure,
  } = params;
  const soeSectors = commandEconomySoeSectors(countryId);
  if (soeSectors.length === 0 || states.length === 0) return [];

  const usdRate = getCountryConfig(countryId, preset).usdExchangeRate || 1;
  const idBase = SOE_ID_BASE_BY_COUNTRY[countryId] ?? 0xa00;
  const seqBase = SOE_SEQUENTIAL_BASE_BY_COUNTRY[countryId] ?? 900_100;
  const eraUnitScale = getEraUnitScale(preset);

  // Plan growth for the state enterprises, from the era monetary baseline
  // (RU 1953 → 6.0). In a market economy an SOE can sit at zero because
  // NPP-founded private firms carry expansion; here EVERY producing sector is
  // an SOE, so a zero target freezes the entire economy — RU ran 136/136
  // sectors at 0.00% and its corporate revenue was byte-identical across the
  // whole run while market economies grew 2.6-4.0%.
  const presetYear = parseInt(preset.slice(0, 4), 10);
  const planGrowthRate =
    getEraTrendGdpGrowth(countryId, Number.isFinite(presetYear) ? presetYear : null) ?? 3;

  // One owned producing sector for (state, sectorType) under `corpId`. Sector
  // revenue is stored in the corp's LOCAL currency: the canonical ₳ market size
  // from computeUnownedSeedRevenue divided back through the country's USD rate,
  // matching the NatCorp convention commodityPriceTurn expects. Under plants,
  // capitalStock is seeded in lockstep from the same ₳ figure so capacity
  // exists on day one (sectorTurn would otherwise lazy-seed from revenue).
  const buildSector = (
    state: StateBudgetSeedInput,
    sectorType: CorporationType,
    corpId: ObjectId
  ) => {
    const revenueAtlantic = computeUnownedSeedRevenue({
      gdp: state.gdp,
      countryId,
      stateId: state.id,
      sectorType,
      preset,
    });
    const revenue = Math.round(revenueAtlantic / usdRate);
    const capitalStock = computeSectorImpliedUnits(sectorType, revenueAtlantic, null, eraUnitScale);
    return {
      _id: new ObjectId(),
      corporationId: corpId,
      countryId,
      stateId: state.id,
      sectorType,
      targetGrowthRate: planGrowthRate,
      currentGrowthRate: planGrowthRate,
      currentGrowthCost: 0,
      revenue,
      capitalStock,
      // Soft-budget state enterprises run thin margins vs private firms.
      profitMargin: 12,
      workers: Math.max(100, Math.round(revenue / 2_000)),
      createdAt: now,
      updatedAt: now,
    };
  };

  return soeSectors.map((sectorType) => {
    const slot = CORPORATION_TYPES.indexOf(sectorType);
    if (slot < 0) {
      throw new Error(`command SOE sectorType ${sectorType} is not a CorporationType`);
    }
    const corpId = soeObjectId(idBase + slot * 8);
    const ceoId = soeObjectId(idBase + slot * 8 + 1);
    const userId = soeObjectId(idBase + slot * 8 + 2);
    const sectors = states.map((state) => buildSector(state, sectorType, corpId));
    const planTarget = sectors.reduce((sum, s) => sum + s.revenue, 0);
    const label = CORPORATION_TYPE_LABELS[sectorType];
    return {
      corporation: {
        _id: corpId,
        sequentialId: seqBase + slot,
        name: `${namePrefix} ${label} Enterprise`,
        description: `State-owned enterprise operating the ${label.toLowerCase()} sector of the ${polityDescriptor}.`,
        type: sectorType,
        countryId,
        ceoId,
        userId,
        headquartersState,
        liquidCapital: 0,
        liquidCurrencyCode: currencyCode,
        marketingBudget: 0,
        marketingStrength: 0,
        logisticsBudget: 0,
        logisticsStrength: 0,
        ceoSalary: 0,
        totalShares: 0,
        sharePrice: 1,
        shareholders: [],
        publicFloat: 0,
        ceoVacant: true,
        countryOwnerId: countryId,
        hiddenFromExchange: false,
        isNationalized: false,
        isPrivate: false,
        isPrimaryNationalCorporation: false,
        assignedSectorTypes: [sectorType],
        soe: makeSeedSoeState(sectorType, planTarget),
        legalStructure,
        createdAt: now,
        updatedAt: now,
      },
      sectors,
    };
  });
}

// ── 1953 market-economy state enterprises (corporate-sector seed-gap fix) ──
// FR/IT/SE/TR/GR/AT/FI are market democracies, not command economies — they
// don't get the RU/CN/Warsaw-Pact multi-SOE stack above. But all seven were
// promoted from the abstract "sphere-macro" tier to full-autonomous
// (ECON_TIER_ROSTER_COUNTRIES in seedEconTierRosters.ts fixed the matching
// political-roster gap, #3253) and NONE of them were ever given a matching
// entry in this function, so every one of them seeded ZERO producing
// corporations — an economic ghost exactly like the pre-fix RU/Warsaw-Pact
// countries, just without the SOE mechanism to catch it. Unlike RU/CN's
// planned economies (state owns 100% of the commanding heights), each of
// these seven is modeled as ONE state-holding corporation that owns a
// REALISTIC MINORITY/PLURALITY SHARE of a handful of real 1953 nationalized
// anchors — the rest of each targeted sector, plus every sector not listed,
// stays in the `unownedSectors` pool for players to found new corporations
// against (same "gravity, not rails" shape as the UK NHS corp above).
//
// Scoped to the 1953 preset only: by 1979/1991/2019 several of these firms
// were privatized (Renault 1996, ENDESA, ENI's later partial float, …) and
// modeling that drift correctly is out of scope for this fix.
//
// ES (Spain) is deliberately EXCLUDED and kept dormant (see
// DORMANT_MARKET_STATE_ENTERPRISE_SPECS below): the 2026-07-28 owner decision
// demoted Spain from full-autonomous to sphere-macro for 1953-default only
// (Franco's dictatorship never holds a legislative election in this preset —
// see worldEntityManifest.ts). seedMacroCountries.ts's own invariant is that
// sphere-macro entities get ZERO corporations/corporateSectors — a real INI
// state-holding corp would contradict that abstraction, so its authored spec
// (ENSIDESA/ENDESA/SEAT/RENFE) is preserved as inert reference for a possible
// future Tier-2 migration rather than deleted outright.
interface MarketStateEnterpriseSectorSpec {
  type: CorporationType;
  /**
   * Share of the (state, sectorType) unowned-market bucket this state
   * enterprise captures, e.g. 0.9 ⇒ the state holds ~90% of that sector's
   * addressable market in every seeded region, the remainder stays unowned.
   */
  marketShare: number;
}

interface MarketStateEnterpriseSpec {
  countryId: CountryId;
  oid: string;
  ceoOid: string;
  userOid: string;
  sequentialId: number;
  name: string;
  description: string;
  headquartersState: string;
  sectors: MarketStateEnterpriseSectorSpec[];
}

/**
 * Build the state-holding corporation + owned `corporateSectors` for ONE
 * market-economy country from a {@link MarketStateEnterpriseSpec}. Mirrors the
 * UK NHS corp's shape (a single nationalized entity capturing a bounded share
 * of the market) rather than the command-economy SOE-per-sector split — these
 * countries are mixed economies, not planned ones, so one holding company
 * across a handful of real state monopolies/majority stakes is the correct
 * unit, not one corp per sector.
 */
function buildMarketStateEnterpriseCorpEntries(params: {
  spec: MarketStateEnterpriseSpec;
  states: StateBudgetSeedInput[];
  preset: string;
  now: Date;
}): CountryOwnedSeedData[] {
  const { spec, states, preset, now } = params;
  const countryStates = states.filter((s) => s.countryId === spec.countryId && s.gdp > 0);
  if (countryStates.length === 0 || spec.sectors.length === 0) return [];

  const usdRate = getCountryConfig(spec.countryId, preset).usdExchangeRate || 1;
  const presetYear = parseInt(preset.slice(0, 4), 10);
  const growthRate =
    getEraTrendGdpGrowth(spec.countryId, Number.isFinite(presetYear) ? presetYear : null) ?? 3;
  const corpId = new ObjectId(spec.oid);

  const sectors: CountryOwnedSeedData["sectors"] = [];
  for (const sectorSpec of spec.sectors) {
    for (const state of countryStates) {
      // Canonical (state, sectorType) market size, same source of truth the
      // unowned-market seeder uses — then take only this enterprise's share.
      const bucketRevenueAtlantic = computeUnownedSeedRevenue({
        gdp: state.gdp,
        countryId: spec.countryId,
        stateId: state.id,
        sectorType: sectorSpec.type,
        preset,
      });
      const revenue = Math.round((bucketRevenueAtlantic / usdRate) * sectorSpec.marketShare);
      sectors.push({
        _id: new ObjectId(),
        corporationId: corpId,
        countryId: spec.countryId,
        stateId: state.id,
        sectorType: sectorSpec.type,
        targetGrowthRate: growthRate,
        currentGrowthRate: growthRate,
        currentGrowthCost: 0,
        revenue,
        // Nationalized-industry margin: thinner than a typical private firm
        // (~35%) but healthier than a soft-budget command SOE (12%) — these
        // firms answer to a market-adjacent P&L, not a plan quota.
        profitMargin: 20,
        workers: Math.max(100, Math.round(revenue / 2_000)),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return [
    {
      corporation: {
        _id: corpId,
        sequentialId: spec.sequentialId,
        name: spec.name,
        description: spec.description,
        type: spec.sectors[0].type,
        countryId: spec.countryId,
        ceoId: new ObjectId(spec.ceoOid),
        userId: new ObjectId(spec.userOid),
        headquartersState: spec.headquartersState,
        liquidCapital: 0,
        liquidCurrencyCode: COUNTRY_CURRENCY_MAP[spec.countryId] as ActiveCurrencyCode,
        marketingBudget: 0,
        marketingStrength: 0,
        logisticsBudget: 0,
        logisticsStrength: 0,
        ceoSalary: 0,
        totalShares: 0,
        sharePrice: 1,
        shareholders: [],
        publicFloat: 0,
        ceoVacant: true,
        countryOwnerId: spec.countryId,
        hiddenFromExchange: false,
        isNationalized: true,
        isPrivate: false,
        isPrimaryNationalCorporation: true,
        legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE[spec.countryId],
        createdAt: now,
        updatedAt: now,
      },
      sectors,
    },
  ];
}

/**
 * The seven ACTIVE market-economy specs (ES moved to
 * {@link DORMANT_MARKET_STATE_ENTERPRISE_SPECS} on 2026-07-28 — see the
 * section doc comment above). OIDs continue the 700…0XXX single-corp
 * sequence (US 011, UK 001, JP 021, DE 031, IE 041, BR 051, CN 061, NG 071,
 * RU 081, DD 091 → this block 0A1-121) and the 900_0NN sequentialId sequence
 * (DD 900_010 → 900_011-900_018). Distinct from the SOE_ID_BASE_BY_COUNTRY hex
 * ranges (0xa00+), which are reserved for the command-economy per-sector SOEs.
 */
const MARKET_STATE_ENTERPRISE_SPECS: MarketStateEnterpriseSpec[] = [
  // France — the 1945 Liberation nationalizations (de Gaulle's provisional
  // government): Renault (auto manufacturer seized from its collaborationist
  // owner), the Banque de France + four deposit banks, EDF/GDF (electricity +
  // gas), and Charbonnages de France (coal). Source: nationalization laws of
  // Dec 1944-May 1946.
  {
    countryId: "FR",
    oid: "7000000000000000000000a1",
    ceoOid: "7000000000000000000000a2",
    userOid: "7000000000000000000000a3",
    sequentialId: 900_011,
    name: "Régie et Charbonnages de France",
    description:
      "State holding for France's 1945-46 Liberation nationalizations: Renault (automobiles), EDF/GDF (electricity and gas), Charbonnages de France (coal), SNCF (rail), and the nationalized deposit banks.",
    headquartersState: "FR_IDF",
    sectors: [
      { type: "energy", marketShare: 0.9 }, // EDF + GDF: near-total electricity/gas monopoly
      { type: "extraction", marketShare: 0.85 }, // Charbonnages de France: coal monopoly
      { type: "logistics", marketShare: 0.55 }, // SNCF: dominant rail, private trucking coexists
      { type: "automobiles", marketShare: 0.35 }, // Renault: ~1/3 of French auto output vs. private Peugeot/Citroën/Simca
      { type: "financial", marketShare: 0.45 }, // Banque de France + 4 deposit banks: ~half of French deposits
    ],
  },
  // Italy — IRI (Istituto per la Ricostruzione Industriale, 1933) held Italy's
  // steel (Finsider), engineering (Finmeccanica) and shipping (Finmare)
  // conglomerates plus large bank stakes; ENI (Ente Nazionale Idrocarburi) was
  // founded in February 1953 — this exact seed year — as the state oil/gas/
  // methane monopoly.
  {
    countryId: "IT",
    oid: "7000000000000000000000b1",
    ceoOid: "7000000000000000000000b2",
    userOid: "7000000000000000000000b3",
    sequentialId: 900_012,
    name: "IRI-ENI Holding",
    description:
      "State holding combining IRI (Istituto per la Ricostruzione Industriale, 1933) — Finsider steel and Finmeccanica engineering — and ENI (Ente Nazionale Idrocarburi), the state hydrocarbon monopoly founded February 1953.",
    headquartersState: "IT_LAZ",
    sectors: [
      { type: "manufacturing", marketShare: 0.4 }, // Finsider steel + Finmeccanica engineering
      { type: "energy", marketShare: 0.5 }, // ENI: state monopoly on Po Valley methane/hydrocarbons
      { type: "logistics", marketShare: 0.6 }, // Finmare: dominant Italian merchant marine
      { type: "financial", marketShare: 0.4 }, // IRI's BIN bank-holding stakes (Comit, Credito Italiano, Banco di Roma)
    ],
  },
  // Sweden — the most private of the eight (SKF, Volvo, LM Ericsson, Alfa
  // Laval all private in 1953), so a deliberately small state sector: SJ
  // (Statens Järnvägar, state railways since 1856), Vattenfall (state
  // hydroelectric authority, 1909), Televerket (state telephone monopoly).
  {
    countryId: "SE",
    oid: "7000000000000000000000d1",
    ceoOid: "7000000000000000000000d2",
    userOid: "7000000000000000000000d3",
    sequentialId: 900_014,
    name: "Statens Affärsverk",
    description:
      "Swedish state-enterprise holding: SJ (Statens Järnvägar, state railways since 1856), Vattenfall (state hydroelectric authority, 1909), and Televerket (state telephone monopoly) — deliberately thin, reflecting how much of the Swedish economy (SKF, Volvo, LM Ericsson) stayed private under the 1953 Saltsjöbaden model.",
    headquartersState: "SE_STH",
    sectors: [
      { type: "logistics", marketShare: 0.7 }, // SJ state railways
      { type: "energy", marketShare: 0.55 }, // Vattenfall state hydro
      { type: "telecommunications", marketShare: 0.85 }, // Televerket state telephone monopoly
    ],
  },
  // Turkey — Kemalist statism's Iktisadi Devlet Teşekkülleri (State Economic
  // Enterprises): Sümerbank (textiles/manufacturing, 1933), Etibank (mining,
  // 1935), TCDD (state railways, 1927 nationalization of foreign concessions),
  // MKE (Makina ve Kimya Endüstrisi, state arms/machinery monopoly, 1950).
  {
    countryId: "TR",
    oid: "7000000000000000000000e1",
    ceoOid: "7000000000000000000000e2",
    userOid: "7000000000000000000000e3",
    sequentialId: 900_015,
    name: "İktisadi Devlet Teşekkülleri Holding",
    description:
      "Kemalist state-industry holding: Sümerbank (textiles/manufacturing, 1933), Etibank (state mining, 1935), TCDD (state railways, nationalized from foreign concessions in 1927), and MKE (Makina ve Kimya Endüstrisi, state arms/machinery monopoly, 1950).",
    headquartersState: "TR_ANK",
    sectors: [
      { type: "manufacturing", marketShare: 0.35 }, // Sümerbank textiles/manufacturing combine
      { type: "extraction", marketShare: 0.5 }, // Etibank state mining
      { type: "logistics", marketShare: 0.75 }, // TCDD full rail monopoly
      { type: "defense", marketShare: 0.9 }, // MKE state arms/machinery monopoly
    ],
  },
  // Greece — smaller state sector than the above, rebuilding after the civil
  // war on American aid: DEI (Dimosia Epicheirisi Ilektrismou, Public Power
  // Corporation, founded 1950) and SEK (state railways); the National Bank of
  // Greece carried large state-linked postwar reconstruction stakes.
  {
    countryId: "GR",
    oid: "700000000000000000000101",
    ceoOid: "700000000000000000000102",
    userOid: "700000000000000000000103",
    sequentialId: 900_016,
    name: "DEI-SEK Dimosies Epicheiriseis",
    description:
      "Greek state-enterprise holding: DEI (Dimosia Epicheirisi Ilektrismou, the Public Power Corporation founded 1950) and SEK (state railways), with a minority state-linked stake in postwar reconstruction banking (National Bank of Greece).",
    headquartersState: "GR_ATT",
    sectors: [
      { type: "energy", marketShare: 0.8 }, // DEI public power monopoly
      { type: "logistics", marketShare: 0.6 }, // SEK state railways
      { type: "financial", marketShare: 0.3 }, // National Bank of Greece postwar state-linked stake
    ],
  },
  // Austria — arguably the most state-heavy of the eight: the 1946/47
  // Verstaatlichungsgesetze (nationalization laws) put ~70% of heavy industry
  // and every major bank under state ownership. VÖEST (steel, incl. Alpine
  // Montan iron ore), the Verbundgesellschaft (national grid, 1947), and the
  // nationalized Creditanstalt-Bankverein / Österreichische Länderbank.
  {
    countryId: "AT",
    oid: "700000000000000000000111",
    ceoOid: "700000000000000000000112",
    userOid: "700000000000000000000113",
    sequentialId: 900_017,
    name: "VÖEST-Verbund Verstaatlichte Industrie",
    description:
      "Austria's 1946/47 Verstaatlichungsgesetze (nationalization laws) holding: VÖEST (steel, including the Alpine Montan iron-ore mines), the Verbundgesellschaft (national electricity grid, founded 1947), and the nationalized Creditanstalt-Bankverein / Österreichische Länderbank.",
    headquartersState: "AT_VIE",
    sectors: [
      { type: "manufacturing", marketShare: 0.45 }, // VÖEST steelworks
      { type: "energy", marketShare: 0.7 }, // Verbundgesellschaft national grid
      { type: "financial", marketShare: 0.5 }, // nationalized Creditanstalt-Bankverein + Länderbank
      { type: "extraction", marketShare: 0.4 }, // Alpine Montan nationalized iron ore
    ],
  },
  // Finland — VR (Valtionrautatiet, state railways), Neste (state oil
  // refiner, founded 1948), Outokumpu (state mining/metallurgy company), and
  // Enso-Gutzeit (state forestry/pulp conglomerate) — the postwar reparations
  // industrial base the 1944-52 Soviet war-reparations deliveries built out.
  {
    countryId: "FI",
    oid: "700000000000000000000121",
    ceoOid: "700000000000000000000122",
    userOid: "700000000000000000000123",
    sequentialId: 900_018,
    name: "Neste-Outokumpu Valtionyhtiöt",
    description:
      "Finnish state-enterprise holding: VR (Valtionrautatiet, state railways), Neste (state oil refiner, founded 1948), Outokumpu (state mining/metallurgy company), and Enso-Gutzeit (state forestry/pulp conglomerate) — the industrial base the 1944-52 Soviet war-reparations deliveries built out.",
    headquartersState: "FI_UUS",
    sectors: [
      { type: "logistics", marketShare: 0.7 }, // VR state railways
      { type: "energy", marketShare: 0.6 }, // Neste state oil refining
      { type: "extraction", marketShare: 0.35 }, // Outokumpu state mining/metallurgy
      { type: "manufacturing", marketShare: 0.3 }, // Enso-Gutzeit state forestry/pulp
    ],
  },
];

/**
 * Dormant market-state-enterprise spec for Spain (ES), left out of
 * {@link MARKET_STATE_ENTERPRISE_SPECS} on 2026-07-28. Spain was demoted from
 * full-autonomous to sphere-macro for 1953-default only (Franco's dictatorship
 * never holds a legislative election in that preset — see
 * worldEntityManifest.ts). Sphere-macro entities must seed ZERO corporations
 * (seedMacroCountries.ts's own invariant), so a real INI state-holding corp
 * would contradict Spain's new abstract-economy classification. Kept here,
 * not seeded by {@link generateCountryOwnedSeedData}, as inert reference for a
 * possible future Tier-2 migration — same treatment as
 * DORMANT_REPROMOTED_EUROPE_1953_MACRO_SPECS in macro/europe1953.ts.
 */
export const DORMANT_MARKET_STATE_ENTERPRISE_SPECS: MarketStateEnterpriseSpec[] = [
  // Spain — INI (Instituto Nacional de Industria, 1941), Franco's autarky-era
  // state-industry vehicle: ENSIDESA (steel, 1950), ENDESA (electricity,
  // 1944), SEAT (the sole mass car maker, 1950, autarky import ban leaves it
  // with near-total domestic share), RENFE (rail, nationalized 1941).
  {
    countryId: "ES",
    oid: "7000000000000000000000c1",
    ceoOid: "7000000000000000000000c2",
    userOid: "7000000000000000000000c3",
    sequentialId: 900_013,
    name: "Instituto Nacional de Industria",
    description:
      "INI (Instituto Nacional de Industria, 1941), Franco-era autarky's state-industry vehicle: ENSIDESA (steel, 1950), ENDESA (electricity, 1944), SEAT (the sole domestic mass car maker, founded under INI in 1950), and RENFE (railways, nationalized 1941).",
    headquartersState: "ES_MAD",
    sectors: [
      { type: "manufacturing", marketShare: 0.45 }, // ENSIDESA integrated steelworks
      { type: "energy", marketShare: 0.5 }, // ENDESA state electricity
      { type: "automobiles", marketShare: 0.7 }, // SEAT: near-monopoly under autarky import bans
      { type: "logistics", marketShare: 0.8 }, // RENFE: full rail monopoly
    ],
  },
];

export function generateCountryOwnedSeedData(
  states: StateBudgetSeedInput[],
  preset: string,
  commandEconomyEnabled: boolean = false
): CountryOwnedSeedData[] {
  const now = new Date();
  const data: CountryOwnedSeedData[] = [
    {
      corporation: {
        _id: US_PUBLIC_CORPORATION_ID,
        sequentialId: US_PUBLIC_CORPORATION_SEQUENTIAL_ID,
        name: "United States",
        description:
          "Country-owned public corporation used as the sovereign issuer identity for U.S. debt.",
        type: "financial",
        countryId: "US",
        ceoId: US_PUBLIC_PLACEHOLDER_CHARACTER_ID,
        userId: US_PUBLIC_PLACEHOLDER_USER_ID,
        headquartersState: "DC",
        liquidCapital: 0,
        liquidCurrencyCode: COUNTRY_CURRENCY_MAP.US as ActiveCurrencyCode,
        marketingBudget: 0,
        marketingStrength: 0,
        logisticsBudget: 0,
        logisticsStrength: 0,
        ceoSalary: 0,
        totalShares: 0,
        sharePrice: 1,
        shareholders: [],
        publicFloat: 0,
        ceoVacant: true,
        countryOwnerId: "US",
        hiddenFromExchange: false,
        isNationalized: false,
        isPrivate: false,
        isPrimaryNationalCorporation: true,
        legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.US,
        createdAt: now,
        updatedAt: now,
      },
      sectors: [],
    },
  ];

  const ukStates = states.filter((state) => state.countryId === "UK" && state.gdp > 0);

  const healthcareIncomeTarget = initialUkBudget.revenue.healthcareIncome;
  if (ukStates.length === 0 || healthcareIncomeTarget <= 0) {
    // No UK states — skip UK corp but still create JP corp below
  } else {
    // Size sectors from the market so market-share percentages stay sane.
    // NHS captures ~80 % of the UK healthcare market in game-unit terms.
    const NHS_MARKET_SHARE = 0.8;
    const totalUkGdp = ukStates.reduce((sum, state) => sum + state.gdp, 0);
    const totalHealthcareMarket = (totalUkGdp * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT;
    const requiredRevenue = Math.round(totalHealthcareMarket * NHS_MARKET_SHARE);

    // Derive the multiplier that bridges game-scale operating income → real budget revenue.
    const effectiveMargin = 0.2; // 35% base margin – 15% nationalized penalty
    const operatingIncome = requiredRevenue * effectiveMargin;
    const budgetRevenueMultiplier =
      operatingIncome > 0 ? Math.round(healthcareIncomeTarget / operatingIncome) : 10;

    const corporation: CountryOwnedSeedData["corporation"] = {
      _id: UK_PUBLIC_CORPORATION_ID,
      sequentialId: UK_PUBLIC_CORPORATION_SEQUENTIAL_ID,
      name: "United Kingdom",
      description:
        "Country-owned public corporation used for nationalized healthcare operations and sovereign issuance.",
      type: "healthcare",
      countryId: "UK",
      ceoId: UK_PUBLIC_PLACEHOLDER_CHARACTER_ID,
      userId: UK_PUBLIC_PLACEHOLDER_USER_ID,
      headquartersState: "LON",
      liquidCapital: Math.round(operatingIncome),
      liquidCurrencyCode: COUNTRY_CURRENCY_MAP.UK as ActiveCurrencyCode,
      marketingBudget: 0,
      marketingStrength: 0,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      totalShares: 0,
      sharePrice: 1,
      shareholders: [],
      publicFloat: 0,
      ceoVacant: true,
      countryOwnerId: "UK",
      hiddenFromExchange: false,
      budgetRevenueKey: "healthcareIncome",
      budgetRevenueMultiplier,
      isNationalized: true,
      isPrivate: false,
      isPrimaryNationalCorporation: true,
      legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.UK,
      createdAt: now,
      updatedAt: now,
    };

    const sectors = ukStates.map((state) => {
      const revenueShare = state.gdp / totalUkGdp;
      const sectorRevenue = Math.round(requiredRevenue * revenueShare);

      return {
        _id: new ObjectId(),
        corporationId: UK_PUBLIC_CORPORATION_ID,
        countryId: "UK" as const,
        stateId: state.id,
        sectorType: "healthcare" as const,
        targetGrowthRate: 0,
        currentGrowthRate: 0,
        currentGrowthCost: 0,
        revenue: sectorRevenue,
        profitMargin: 35,
        workers: Math.max(100, Math.round(sectorRevenue / 2_000)),
        createdAt: now,
        updatedAt: now,
      };
    });

    data.push({ corporation, sectors });
  } // end UK corp block

  // ── JP sovereign issuer ─────────────────────────────────────────────────
  data.push({
    corporation: {
      _id: JP_PUBLIC_CORPORATION_ID,
      sequentialId: JP_PUBLIC_CORPORATION_SEQUENTIAL_ID,
      name: "Japan",
      description: "Country-owned sovereign issuer identity for Japanese government debt.",
      type: "financial",
      countryId: "JP",
      ceoId: JP_PUBLIC_PLACEHOLDER_CHARACTER_ID,
      userId: JP_PUBLIC_PLACEHOLDER_USER_ID,
      headquartersState: "KAN",
      liquidCapital: 0,
      liquidCurrencyCode: COUNTRY_CURRENCY_MAP.JP as ActiveCurrencyCode,
      marketingBudget: 0,
      marketingStrength: 0,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      totalShares: 0,
      sharePrice: 1,
      shareholders: [],
      publicFloat: 0,
      ceoVacant: true,
      countryOwnerId: "JP",
      hiddenFromExchange: false,
      isNationalized: false,
      isPrivate: false,
      isPrimaryNationalCorporation: true,
      legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.JP,
      createdAt: now,
      updatedAt: now,
    },
    sectors: [],
  });

  // ── USSR (RU) state enterprise — the command economy's producing base ───
  // Unlike the market economies (whose producing sectors come from player
  // corporations), the USSR has no players, so without state-owned sectors it
  // is an economic ghost. Seed the RU National Corporation to OWN producing
  // sectors across the commanding heights in every Soviet region, so RU
  // generates commodity supply each turn. Sector revenue is stored in the
  // corp's LOCAL currency (SUR): computeUnownedSeedRevenue returns the
  // canonical market size in ₳, divided back to SUR via the RU exchange rate
  // (corporateSectors.revenue is liquidCurrencyCode-denominated — matching the
  // UK/CN NatCorp convention and what commodityPriceTurn expects).
  const ruStates = states.filter((state) => state.countryId === "RU" && state.gdp > 0);
  if (ruStates.length > 0) {
    // Preset-aware: the ₳→SUR rate is era-specific (1953 = 9 SUR/USD, the
    // Western GNP-estimate basis ruRegions1953 is calibrated on; the base
    // config carries the 1979 administered rate). Reading it era-blind divided
    // 1953 ₳ market sizes by the 1979 rate — the same denominator the
    // `revenueAtlantic` numerator no longer uses, so the two stopped cancelling.
    const ruUsdRate = getCountryConfig("RU", preset).usdExchangeRate || 1;

    // Plan growth target for the Soviet SOEs, from the era monetary baseline
    // (RU 1953 → 6.0). Falls back to the private-firm seed rate so a preset with
    // no authored trend still expands rather than freezing.
    const ruPresetYear = parseInt(preset.slice(0, 4), 10);
    const ruPlanGrowthRate =
      getEraTrendGdpGrowth("RU", Number.isFinite(ruPresetYear) ? ruPresetYear : null) ?? 3;

    // Build one owned producing sector for (state, sectorType) under `corpId`.
    const buildRuSector = (
      state: StateBudgetSeedInput,
      sectorType: CorporationType,
      corpId: ObjectId
    ) => {
      const revenueAtlantic = computeUnownedSeedRevenue({
        gdp: state.gdp,
        countryId: "RU",
        stateId: state.id,
        sectorType,
        preset,
      });
      // ₳ → SUR so the value matches the corp's SUR liquidCurrencyCode.
      const revenue = Math.round(revenueAtlantic / ruUsdRate);
      return {
        _id: new ObjectId(),
        corporationId: corpId,
        countryId: "RU" as const,
        stateId: state.id,
        sectorType,
        // Plan growth. A market economy's SOEs can sit at zero because private
        // NPP-founded firms (spawnNppCorporation seeds targetGrowthRate 3) carry
        // expansion. In a COMMAND economy every producing sector is an SOE, so a
        // zero target froze the whole economy: RU ran 136/136 sectors at 0.00%
        // and its corporate revenue was byte-identical for the entire run
        // ($566.31M across 24 turns) while the US/DE/JP grew 2.6-4.0%. The USSR's
        // own 1953 baseline authors trendGdpGrowth 6.0, so the planner targets
        // that instead of standing still.
        targetGrowthRate: ruPlanGrowthRate,
        currentGrowthRate: ruPlanGrowthRate,
        currentGrowthCost: 0,
        revenue,
        // Soft-budget state enterprises run thin margins vs private firms.
        profitMargin: 12,
        workers: Math.max(100, Math.round(revenue / 2_000)),
        createdAt: now,
        updatedAt: now,
      };
    };

    // The primary National Corp — always the USSR sovereign-bond issuer.
    const ruPrimaryCorp: CountryOwnedSeedData["corporation"] = {
      _id: RU_PUBLIC_CORPORATION_ID,
      sequentialId: RU_PUBLIC_CORPORATION_SEQUENTIAL_ID,
      name: "Soviet Union",
      description:
        "State enterprise operating the commanding heights of the Soviet planned economy (also the sovereign issuer identity for USSR debt).",
      type: "manufacturing",
      countryId: "RU",
      ceoId: RU_PUBLIC_PLACEHOLDER_CHARACTER_ID,
      userId: RU_PUBLIC_PLACEHOLDER_USER_ID,
      headquartersState: "CEN", // Central Russia (Moscow)
      liquidCapital: 0,
      liquidCurrencyCode: COUNTRY_CURRENCY_MAP.RU as ActiveCurrencyCode,
      marketingBudget: 0,
      marketingStrength: 0,
      logisticsBudget: 0,
      logisticsStrength: 0,
      ceoSalary: 0,
      totalShares: 0,
      sharePrice: 1,
      shareholders: [],
      publicFloat: 0,
      ceoVacant: true,
      countryOwnerId: "RU",
      hiddenFromExchange: false,
      isNationalized: false,
      isPrivate: false,
      isPrimaryNationalCorporation: true,
      legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.RU,
      createdAt: now,
      updatedAt: now,
    };

    // Command Economy v2 (P0): when the flag is on, split the single National
    // Corp into ONE state-owned enterprise per commanding-height sector (each
    // carrying the SoeState overlay + owning its sector across every region);
    // the primary corp stays the bare sovereign issuer. Flag off → the legacy
    // single-corp-owns-everything shape, byte-identical.
    const soeSectors = commandEconomySoeSectors("RU");
    const useMultiSoe = commandEconomyEnabled && soeSectors.length > 0;

    if (!useMultiSoe) {
      const ruSectors = ruStates.flatMap((state) =>
        RU_COMMANDING_HEIGHTS.map((sectorType) =>
          buildRuSector(state, sectorType, RU_PUBLIC_CORPORATION_ID)
        )
      );
      data.push({ corporation: ruPrimaryCorp, sectors: ruSectors });
    } else {
      // Primary corp = sovereign issuer only (producing sectors move to SOEs).
      data.push({ corporation: ruPrimaryCorp, sectors: [] });
      // One SOE per commanding-height sector (shared with CN's command-era split).
      data.push(
        ...buildCommandSoeCorpEntries({
          countryId: "RU",
          states: ruStates,
          preset,
          now,
          namePrefix: "Soviet",
          polityDescriptor: "Soviet planned economy",
          headquartersState: "CEN",
          currencyCode: COUNTRY_CURRENCY_MAP.RU as ActiveCurrencyCode,
          legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.RU,
        })
      );
    }
  }

  // ── DE / IE / BR / CN sovereign issuers ────────────────────────────────
  // Each country's bond/sovereign-default code expects a country-owned corp
  // to reference. Without these the budget seeders for DE/IE/BR/CN are
  // missing the matching issuer identity, so sovereign-default scenarios
  // crash trying to look up imfSovereignFacilityImfCorporationId pointer
  // targets. Seeded with the same minimal "financial" shape as JP.
  const sovereignIssuerSpec: Array<{
    countryId: CountryId;
    oid: string;
    ceoOid: string;
    userOid: string;
    sequentialId: number;
    name: string;
    headquartersState: string;
  }> = [
    {
      countryId: "DE",
      oid: DE_PUBLIC_CORPORATION_OID,
      ceoOid: DE_PUBLIC_CEO_OID,
      userOid: DE_PUBLIC_USER_OID,
      sequentialId: DE_PUBLIC_SEQUENTIAL_ID,
      name: "Germany",
      headquartersState: "BE",
    },
    {
      countryId: "IE",
      oid: IE_PUBLIC_CORPORATION_OID,
      ceoOid: IE_PUBLIC_CEO_OID,
      userOid: IE_PUBLIC_USER_OID,
      sequentialId: IE_PUBLIC_SEQUENTIAL_ID,
      name: "Ireland",
      headquartersState: "D",
    },
    {
      countryId: "BR",
      oid: BR_PUBLIC_CORPORATION_OID,
      ceoOid: BR_PUBLIC_CEO_OID,
      userOid: BR_PUBLIC_USER_OID,
      sequentialId: BR_PUBLIC_SEQUENTIAL_ID,
      name: "Brazil",
      headquartersState: "DF",
    },
    {
      countryId: "CN",
      oid: CN_PUBLIC_CORPORATION_OID,
      ceoOid: CN_PUBLIC_CEO_OID,
      userOid: CN_PUBLIC_USER_OID,
      sequentialId: CN_PUBLIC_SEQUENTIAL_ID,
      name: "China",
      headquartersState: "BJ",
    },
    {
      countryId: "NG",
      oid: NG_PUBLIC_CORPORATION_OID,
      ceoOid: NG_PUBLIC_CEO_OID,
      userOid: NG_PUBLIC_USER_OID,
      sequentialId: NG_PUBLIC_SEQUENTIAL_ID,
      name: "Nigeria",
      headquartersState: "NORTH_CENTRAL", // FCT Abuja falls within the North-Central zone
    },
    // Sovereign issuer ONLY — emitted with `sectors: []`. DD is a command
    // economy and has no private corporations by design; this exists so the
    // bond seeder has a real corporation to point its tranches at.
    {
      countryId: "DD",
      oid: DD_PUBLIC_CORPORATION_OID,
      ceoOid: DD_PUBLIC_CEO_OID,
      userOid: DD_PUBLIC_USER_OID,
      sequentialId: DD_PUBLIC_SEQUENTIAL_ID,
      name: "East Germany",
      headquartersState: "BEO",
    },
  ];

  for (const spec of sovereignIssuerSpec) {
    data.push({
      corporation: {
        _id: new ObjectId(spec.oid),
        sequentialId: spec.sequentialId,
        name: spec.name,
        description: `Country-owned sovereign issuer identity for ${spec.name} government debt.`,
        type: "financial",
        countryId: spec.countryId,
        ceoId: new ObjectId(spec.ceoOid),
        userId: new ObjectId(spec.userOid),
        headquartersState: spec.headquartersState,
        liquidCapital: 0,
        liquidCurrencyCode: COUNTRY_CURRENCY_MAP[spec.countryId] as ActiveCurrencyCode,
        marketingBudget: 0,
        marketingStrength: 0,
        logisticsBudget: 0,
        logisticsStrength: 0,
        ceoSalary: 0,
        totalShares: 0,
        sharePrice: 1,
        shareholders: [],
        publicFloat: 0,
        ceoVacant: true,
        countryOwnerId: spec.countryId,
        hiddenFromExchange: false,
        isNationalized: false,
        isPrivate: false,
        isPrimaryNationalCorporation: true,
        legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE[spec.countryId],
        createdAt: now,
        updatedAt: now,
      },
      sectors: [],
    });
  }

  // ── CN command-era SOEs (Command Economy v2, #3496) ──────────────────────
  // Unlike RU (no player corps → the state owns EVERYTHING), CN is a playable,
  // market-capable country whose producing supply normally comes from player
  // corporations + the unowned market pool. So CN gets the RU-style per-sector
  // SOE split ONLY in its FULLY-COMMAND band (the First-Five-Year-Plan era,
  // scheduled marketization < COMMAND_CEILING), where the state legitimately
  // owns the commanding heights and there is no private producing base yet. In
  // the dual-track (1979–92) and socialist-market (1993+) bands CN keeps today's
  // shape (bare sovereign issuer; supply from player/market corps), so those
  // eras never sprout a full command SOE stack. The bare CN sovereign issuer
  // seeded above stays the primary bond-issuer identity — these SOEs are the
  // non-primary producing arms with deterministic 0xB00-range ids that never
  // collide with the issuer or player-founded corporations. Only OWNED sectors
  // count as commodity supply, so this adds the SOE-performance channel without
  // double-counting the unowned market pool.
  const cnStates = states.filter((state) => state.countryId === "CN" && state.gdp > 0);
  if (commandEconomyEnabled && cnStates.length > 0 && commandEconomySoeSectors("CN").length > 0) {
    const cnSeedYear = getNationalBudgetSeedConfigsForPreset(preset).find(
      (c) => c.countryId === "CN"
    )?.fiscalYear;
    const cnInCommandBand =
      cnSeedYear != null && scheduledMarketizationLevel("CN", cnSeedYear) < COMMAND_CEILING;
    if (cnInCommandBand) {
      data.push(
        ...buildCommandSoeCorpEntries({
          countryId: "CN",
          states: cnStates,
          preset,
          now,
          namePrefix: "Chinese",
          polityDescriptor: "Chinese planned economy",
          headquartersState: "BJ",
          currencyCode: COUNTRY_CURRENCY_MAP.CN as ActiveCurrencyCode,
          legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE.CN,
        })
      );
    }
  }

  // ── Warsaw-Pact satellite SOEs (command-economy seed-gap fix) ────────────
  // DD/PL/HU/CS/BG/RO are Warsaw-Pact command economies (MARKETIZATION_SCHEDULE
  // keeps every one of them under COMMAND_CEILING through the 1953/1979 window
  // this seeder ever runs for — `seedEasternBlocBudget` gates its whole pass on
  // `isEasternBlocEra`). Before this fix these six had ZERO producing corporate
  // objects: DD's only "corporation" was its bare bond-issuer shell (pushed by
  // `sovereignIssuerSpec` above, `sectors: []`), and the other five had no
  // country-owned corp at all — all six countries' actual output existed only
  // as `unownedSectors` documents, so a player taking DD (a PLAYER country in
  // this era) inherited an economy with no enterprises to direct. Like RU (no
  // player producing base) and unlike CN (which keeps a dual-track/market
  // band where player/market corps carry supply), each of these six always
  // gets the full commanding-height SOE split whenever the flag is on AND its
  // era-scheduled level is fully command — checked explicitly (rather than
  // assumed) so a future preset for one of them outside the command band
  // doesn't silently sprout a command SOE stack it shouldn't have.
  const WARSAW_PACT_SOE_SPEC: Array<{
    countryId: CountryId;
    namePrefix: string;
    polityDescriptor: string;
    headquartersState: string;
  }> = [
    {
      countryId: "DD",
      namePrefix: "East German",
      polityDescriptor: "East German planned economy",
      headquartersState: "BEO", // East Berlin
    },
    {
      countryId: "PL",
      namePrefix: "Polish",
      polityDescriptor: "Polish planned economy",
      headquartersState: "PL_MAZ", // Warsaw / Mazowieckie
    },
    {
      countryId: "HU",
      namePrefix: "Hungarian",
      polityDescriptor: "Hungarian planned economy",
      headquartersState: "HU_BUD", // Budapest
    },
    {
      countryId: "CS",
      namePrefix: "Czechoslovak",
      polityDescriptor: "Czechoslovak planned economy",
      headquartersState: "CS_PRG", // Prague
    },
    {
      countryId: "BG",
      namePrefix: "Bulgarian",
      polityDescriptor: "Bulgarian planned economy",
      headquartersState: "BG_SOF", // Sofia
    },
    {
      countryId: "UKR",
      namePrefix: "Ukrainian",
      polityDescriptor: "Ukrainian planned economy",
      headquartersState: "UKR_KYI", // Kyiv
    },
    {
      countryId: "BLR",
      namePrefix: "Byelorussian",
      polityDescriptor: "Byelorussian planned economy",
      headquartersState: "BLR_MIN", // Minsk
    },
    {
      countryId: "BAL",
      namePrefix: "Baltic",
      polityDescriptor: "Baltic planned economy",
      headquartersState: "BAL_LVA", // Riga
    },
    {
      countryId: "RO",
      namePrefix: "Romanian",
      polityDescriptor: "Romanian planned economy",
      headquartersState: "RO_BUC", // Bucharest
    },
    // Yugoslavia is not a Warsaw-Pact member (see COMMAND_ECONOMY_SOE_SECTORS.YU
    // for the non-alignment note), but it shares this same command-economy
    // seed-gap: promoted to full-autonomous Tier-1 alongside PL/HU/CS/BG/RO
    // (seedManifest.ts) yet never given the matching SOE stack, so it sat at
    // zero corporateSectors rows while its five peers above all seeded fine.
    {
      countryId: "YU",
      namePrefix: "Yugoslav",
      polityDescriptor: "Yugoslav planned economy",
      headquartersState: "YU_SRB", // Belgrade / Serbia
    },
  ];

  if (commandEconomyEnabled) {
    for (const spec of WARSAW_PACT_SOE_SPEC) {
      const blocStates = states.filter(
        (state) => state.countryId === spec.countryId && state.gdp > 0
      );
      if (blocStates.length === 0 || commandEconomySoeSectors(spec.countryId).length === 0) {
        continue;
      }
      const blocSeedYear = getNationalBudgetSeedConfigsForPreset(preset).find(
        (c) => c.countryId === spec.countryId
      )?.fiscalYear;
      const blocInCommandBand =
        blocSeedYear != null &&
        scheduledMarketizationLevel(spec.countryId, blocSeedYear) < COMMAND_CEILING;
      if (!blocInCommandBand) continue;

      data.push(
        ...buildCommandSoeCorpEntries({
          countryId: spec.countryId,
          states: blocStates,
          preset,
          now,
          namePrefix: spec.namePrefix,
          polityDescriptor: spec.polityDescriptor,
          headquartersState: spec.headquartersState,
          currencyCode: COUNTRY_CURRENCY_MAP[spec.countryId] as ActiveCurrencyCode,
          legalStructure: SOVEREIGN_CORP_LEGAL_STRUCTURE[spec.countryId],
        })
      );
    }
  }

  // Market-economy state enterprises (FR/IT/ES/SE/TR/GR/AT/FI) — scoped to the
  // 1953 preset, the only era this corporate-sector seed-gap was audited
  // against (see MARKET_STATE_ENTERPRISE_SPECS' docstring for why later eras
  // are out of scope).
  if (preset === "1953-default") {
    for (const spec of MARKET_STATE_ENTERPRISE_SPECS) {
      data.push(...buildMarketStateEnterpriseCorpEntries({ spec, states, preset, now }));
    }
  }

  return data;
}

export function generateStateBudgets(
  states: StateBudgetSeedInput[],
  fiscalYear: number = 2020
): StateBudget[] {
  return states.map((state) => {
    // state.gdp is in millions (e.g. 3598500 = $3.6T). Convert to dollars
    // so all budget values (tax bases, revenue, spending) are in dollars,
    // consistent with the federal budget and the display formatters.
    const stateGdp = state.gdp * 1_000_000;
    // Tax bases derived from state GDP. Corporate profits split 75/25 domestic/foreign
    // at seed — the per-turn simulation rewrites both fields with actual corp income.
    const taxableIncome = stateGdp * 0.35; // 35% of GDP
    const taxableSales = stateGdp * 0.55; // 55% of GDP (consumer spending)
    const domesticCorporateProfits = stateGdp * 0.06; // 6% of GDP — domestic corps
    const foreignCorporateProfits = stateGdp * 0.02; // 2% of GDP — foreign corps
    const propertyValue = stateGdp * 3.0; // Property values ~3x GDP

    // Default tax rates — country-specific. Foreign rate mirrors domestic at seed (day-one
    // parity per migration spec); legislators can diverge them later via the foreign bills.
    const DEFAULT_RATES: Record<
      string,
      {
        incomeTax: number;
        salesTax: number;
        domesticCorporateTax: number;
        foreignCorporateTax: number;
        propertyTax: number;
      }
    > = {
      US: {
        incomeTax: 5,
        salesTax: 6,
        domesticCorporateTax: 6,
        foreignCorporateTax: 6,
        propertyTax: 1,
      },
      UK: {
        incomeTax: 0,
        salesTax: 0,
        domesticCorporateTax: 1,
        foreignCorporateTax: 1,
        propertyTax: 1.6,
      },
      JP: {
        incomeTax: 0,
        salesTax: 0,
        domesticCorporateTax: 1.5,
        foreignCorporateTax: 1.5,
        propertyTax: 1.4,
      },
      DE: {
        incomeTax: 0,
        salesTax: 0,
        domesticCorporateTax: 1.5,
        foreignCorporateTax: 1.5,
        propertyTax: 1.2,
      },
      IE: {
        incomeTax: 0,
        salesTax: 0,
        domesticCorporateTax: 1.0, // low 12.5% corporate rate
        foreignCorporateTax: 1.0,
        propertyTax: 1.0,
      },
      BR: {
        incomeTax: 3,
        salesTax: 5,
        domesticCorporateTax: 2.5,
        foreignCorporateTax: 2.5,
        propertyTax: 1.0,
      },
      CN: {
        incomeTax: 2,
        salesTax: 4,
        domesticCorporateTax: 2.0,
        foreignCorporateTax: 1.5,
        propertyTax: 0.5,
      },
    };
    const ctry = state.countryId ?? "US";
    const rates = DEFAULT_RATES[ctry] ?? DEFAULT_RATES.US;

    // Central government grant multiplier — parliamentary systems use larger transfers
    const GRANT_MULTIPLIERS: Record<string, number> = {
      US: 0.012,
      UK: 0.022,
      JP: 0.018,
      DE: 0.02,
      IE: 0.022, // similar to UK — centralised parliamentary transfers
      BR: 0.015, // federal transfers to states
      CN: 0.025, // large central-government fiscal transfers
    };
    const grantRate = GRANT_MULTIPLIERS[ctry] ?? 0.012;

    // Calculate revenue from bases × rates
    const incomeTaxRevenue = taxableIncome * (rates.incomeTax / 100);
    const salesTaxRevenue = taxableSales * (rates.salesTax / 100);
    const domesticCorporateTaxRevenue =
      domesticCorporateProfits * (rates.domesticCorporateTax / 100);
    const foreignCorporateTaxRevenue = foreignCorporateProfits * (rates.foreignCorporateTax / 100);
    const propertyTaxRevenue = propertyValue * (rates.propertyTax / 100);
    const federalGrants = stateGdp * grantRate;

    const totalRevenue =
      incomeTaxRevenue +
      salesTaxRevenue +
      domesticCorporateTaxRevenue +
      foreignCorporateTaxRevenue +
      propertyTaxRevenue +
      federalGrants;

    return {
      _id: state.id,
      stateId: state.id,
      ...(state.countryId
        ? { countryId: state.countryId as import("@/lib/constants/countries").CountryId }
        : {}),
      fiscalYear,
      stateGdp: stateGdp,
      taxBases: {
        taxableIncome,
        taxableSales,
        domesticCorporateProfits,
        foreignCorporateProfits,
        propertyValue,
      },
      revenue: {
        incomeTax: incomeTaxRevenue,
        salesTax: salesTaxRevenue,
        domesticCorporateTax: domesticCorporateTaxRevenue,
        foreignCorporateTax: foreignCorporateTaxRevenue,
        propertyTax: propertyTaxRevenue,
        federalGrants: federalGrants,
        other: 0,
        total: totalRevenue,
      },
      taxRates: rates,
      spending: {
        byCategory: {
          education: totalRevenue * 0.35,
          healthcare: totalRevenue * 0.25,
          transportation: totalRevenue * 0.15,
          publicSafety: totalRevenue * 0.12,
          other: totalRevenue * 0.13,
        },
        total: totalRevenue,
      },
      balance: 0,
      surplus: 0,
      updatedAt: new Date(),
    };
  });
}

export const deStateBudgets = generateStateBudgets(deRegionalBudgetInputs);
export const ieStateBudgets = generateStateBudgets(ieRegionalBudgetInputs);
export const brStateBudgets = generateStateBudgets(brRegionalBudgetInputs);
export const cnStateBudgets = generateStateBudgets(cnRegionalBudgetInputs);
