import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Sector fund mapping: every CorporationType gets its own standalone sector fund.
 * No composites — each game sector maps 1:1 to a fund.
 */
export const SECTOR_FUND_MAPPINGS: readonly {
  sectorType: CorporationType;
  sectorLabel: string;
  ticker: string;
}[] = [
  { sectorType: "financial", sectorLabel: "Financials", ticker: "GLBFIN" },
  { sectorType: "media", sectorLabel: "Media", ticker: "GLBMEA" },
  { sectorType: "manufacturing", sectorLabel: "Manufacturing", ticker: "GLBMFG" },
  { sectorType: "chemical_industries", sectorLabel: "Chemicals", ticker: "GLBCHM" },
  { sectorType: "healthcare", sectorLabel: "Healthcare", ticker: "GLBHLT" },
  { sectorType: "retail", sectorLabel: "Retail", ticker: "GLBRTL" },
  { sectorType: "automobiles", sectorLabel: "Automobiles", ticker: "GLBAUT" },
  { sectorType: "technology", sectorLabel: "Technology", ticker: "GLBTEC" },
  { sectorType: "energy", sectorLabel: "Energy", ticker: "GLBENR" },
  { sectorType: "agriculture", sectorLabel: "Agriculture", ticker: "GLBAGR" },
  { sectorType: "real_estate", sectorLabel: "Real Estate", ticker: "GLBRE" },
  { sectorType: "construction", sectorLabel: "Construction", ticker: "GLBCON" },
  { sectorType: "defense", sectorLabel: "Defense", ticker: "GLBDEF" },
  { sectorType: "telecommunications", sectorLabel: "Telecom", ticker: "GLBCOM" },
  { sectorType: "entertainment", sectorLabel: "Entertainment", ticker: "GLBENT" },
  { sectorType: "logistics", sectorLabel: "Logistics", ticker: "GLBTRN" },
  { sectorType: "extraction", sectorLabel: "Extraction & Mining", ticker: "GLBEXT" },
] as const;

/**
 * Corporation types that map to each sector fund.
 * Since every type now has its own standalone fund, each entry is a singleton.
 * Secondary-type matching in isEligibleIndexFundConstituent still falls back
 * here if a corp's primary type differs from its sector fund type.
 */
export const SECTOR_FUND_PRIMARY_TYPES: Record<string, CorporationType[]> = {
  Financials: ["financial"],
  Media: ["media"],
  Manufacturing: ["manufacturing"],
  Chemicals: ["chemical_industries"],
  Healthcare: ["healthcare"],
  Retail: ["retail"],
  Automobiles: ["automobiles"],
  Technology: ["technology"],
  Energy: ["energy"],
  Agriculture: ["agriculture"],
  "Real Estate": ["real_estate"],
  Construction: ["construction"],
  Defense: ["defense"],
  Telecom: ["telecommunications"],
  Entertainment: ["entertainment"],
  Logistics: ["logistics"],
  "Extraction & Mining": ["extraction"],
};

/**
 * Per-country broad-market fund definitions.
 * Every country with an active stock exchange gets Top 25 and Top 50 funds.
 */
export type CountryFundDef = {
  countryId: CountryId;
  currencyCode: CurrencyCode;
  funds: readonly {
    kind: "broad";
    topN: number;
    slug: string;
    name: string;
    ticker: string;
  }[];
};

/** Build the slug, name, and ticker for a country broad-market fund. */
function countryFundSlug(countryId: CountryId, topN: number): string {
  return `${countryId.toLowerCase()}_top_${topN}`;
}
function countryFundName(countryId: CountryId, topN: number): string {
  const names: Record<string, Record<number, string>> = {
    US: { 25: "US Large-Cap 25 Index", 50: "US Broad Market 50 Index" },
    UK: { 25: "FTSE 25 Index", 50: "FTSE 50 Index" },
    JP: { 25: "Nikkei 25 Index", 50: "Nikkei 50 Index" },
    DE: { 25: "DAX 25 Index", 50: "DAX 50 Index" },
    IE: { 25: "ISEQ 25 Index", 50: "ISEQ 50 Index" },
    BR: { 25: "B3 25 Index", 50: "B3 50 Index" },
    CN: { 25: "SSE 25 Index", 50: "SSE 50 Index" },
    NG: { 25: "NGX 25 Index", 50: "NGX 50 Index" },
  };
  return names[countryId]?.[topN] ?? `${countryId} Top ${topN}`;
}
function countryFundTicker(countryId: CountryId, topN: number): string {
  // e.g. US25, JP50 — max 5 chars for ticker
  return `${countryId}${topN}`;
}

/** All countries with stock exchanges (broad-market fund anchors). */
export const BROAD_FUND_COUNTRIES: readonly {
  countryId: CountryId;
  currencyCode: CurrencyCode;
}[] = [
  { countryId: "US", currencyCode: "USD" },
  { countryId: "UK", currencyCode: "GBP" },
  { countryId: "JP", currencyCode: "JPY" },
  { countryId: "DE", currencyCode: "EUR" },
  { countryId: "IE", currencyCode: "IEP" },
  { countryId: "BR", currencyCode: "BRL" },
  { countryId: "CN", currencyCode: "CNY" },
  { countryId: "NG", currencyCode: "NGN" },
] as const;

/** All broad-market fund definitions. */
export const BROAD_FUND_DEFINITIONS: readonly CountryFundDef[] = BROAD_FUND_COUNTRIES.map(
  ({ countryId, currencyCode }) => ({
    countryId,
    currencyCode,
    funds: [
      {
        kind: "broad" as const,
        topN: 25,
        slug: countryFundSlug(countryId, 25),
        name: countryFundName(countryId, 25),
        ticker: countryFundTicker(countryId, 25),
      },
      {
        kind: "broad" as const,
        topN: 50,
        slug: countryFundSlug(countryId, 50),
        name: countryFundName(countryId, 50),
        ticker: countryFundTicker(countryId, 50),
      },
    ],
  })
);

/** Global Top 50 fund (USD-anchored, covers all eligible countries). */
export const GLOBAL_BROAD_FUND = {
  slug: "global_top_50",
  name: "Global Top 50 Index",
  ticker: "GLB50",
  scope: "global" as const,
  kind: "broad" as const,
  anchorCurrencyCode: "USD" as CurrencyCode,
  topN: 50,
};

/** All sector fund definitions (USD-anchored, global). */
export const SECTOR_FUND_DEFINITIONS: readonly {
  kind: "sector";
  scope: "global";
  sectorType: CorporationType;
  sectorLabel: string;
  slug: string;
  name: string;
  ticker: string;
  anchorCurrencyCode: CurrencyCode;
}[] = SECTOR_FUND_MAPPINGS.map(({ sectorType, sectorLabel, ticker }) => ({
  kind: "sector" as const,
  scope: "global" as const,
  sectorType,
  sectorLabel,
  slug: `global_sector_${sectorType}`,
  name: `Global ${sectorLabel} Index`,
  ticker,
  anchorCurrencyCode: "USD" as CurrencyCode,
}));

/**
 * Complete inventory of all fund definitions to seed.
 * Used by the seed/migration to upsert fund definitions into `indexFunds`.
 */
export function getAllFundDefinitions() {
  const funds: {
    slug: string;
    name: string;
    ticker: string;
    scope: "country" | "global";
    kind: "broad" | "sector";
    countryId?: CountryId;
    topN?: number;
    sectorType?: CorporationType;
    anchorCurrencyCode: CurrencyCode;
  }[] = [];

  for (const def of BROAD_FUND_DEFINITIONS) {
    for (const fund of def.funds) {
      funds.push({
        slug: fund.slug,
        name: fund.name,
        ticker: fund.ticker,
        scope: "country",
        kind: fund.kind,
        countryId: def.countryId,
        topN: fund.topN,
        anchorCurrencyCode: def.currencyCode,
      });
    }
  }

  funds.push({
    slug: GLOBAL_BROAD_FUND.slug,
    name: GLOBAL_BROAD_FUND.name,
    ticker: GLOBAL_BROAD_FUND.ticker,
    scope: GLOBAL_BROAD_FUND.scope,
    kind: GLOBAL_BROAD_FUND.kind,
    topN: GLOBAL_BROAD_FUND.topN,
    anchorCurrencyCode: GLOBAL_BROAD_FUND.anchorCurrencyCode,
  });

  for (const sector of SECTOR_FUND_DEFINITIONS) {
    funds.push({
      slug: sector.slug,
      name: sector.name,
      ticker: sector.ticker,
      scope: sector.scope,
      kind: sector.kind,
      sectorType: sector.sectorType,
      anchorCurrencyCode: sector.anchorCurrencyCode,
    });
  }

  return funds;
}
