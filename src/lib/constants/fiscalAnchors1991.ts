/**
 * 1991 national accounts and fiscal anchors for the eight Western European
 * economies whose seeds were authored in 1979 local currency (#3034): FR, IT,
 * ES, SE, TR, GR, AT, FI.
 *
 * Pure data, no imports, so the currency table, the budget seeds and the
 * regional bundles all read ONE sourced set. Every number below is either
 * copied from a named public series or derived from one by the stated
 * conversion. Nothing is estimated.
 *
 * SOURCES (retrieved 2026-10-05, World Bank release dated 2026-07-13)
 *   GDP, current LCU:   World Bank WDI NY.GDP.MKTP.CN, year 1991
 *   GDP, current US$:   World Bank WDI NY.GDP.MKTP.CD, year 1991
 *   FX, LCU per US$:    World Bank WDI PA.NUS.FCRF (period average), year 1991
 *   Real growth, CPI:   World Bank WDI NY.GDP.MKTP.KD.ZG, FP.CPI.TOTL.ZG, year 1991
 *   Gov expenditure:    IMF World Economic Outlook, general government total
 *                       expenditure, % of GDP (datamapper G_X_G01_GDP_PT), 1991
 *   Gov gross debt:     IMF World Economic Outlook, general government gross
 *                       debt, % of GDP (datamapper GGXWDG_NGDP), 1991
 *   https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;TUR;GRC;AUT;FIN/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 *   https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;TUR;GRC;AUT;FIN/indicator/PA.NUS.FCRF?date=1991&format=json
 *   https://api.worldbank.org/v2/country/FRA;ITA;ESP;SWE;TUR;GRC;AUT;FIN/indicator/NY.GDP.MKTP.CD?date=1991&format=json
 *   https://www.imf.org/external/datamapper/api/v1/G_X_G01_GDP_PT
 *   https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP
 *
 * DERIVATIONS
 *   - WDI reports euro-area members in euro and Turkey in the 2005 new lira.
 *     The game's currencies are the legacy ones, so GDP is converted with the
 *     irrevocable conversion rates (Council Regulation (EC) 2866/98 for FRF,
 *     ITL, ESP, ATS, FIM; Council Regulation (EC) 1175/2000 for GRD) and the
 *     1,000,000 old to 1 new lira redenomination (Law 5083 of 2004) for TRL.
 *   - The rate is WDI's own 1991 period average. It is the same unit the
 *     legacy-currency GDP above is expressed in, so legacyGdp / rate
 *     reproduces WDI's US$ GDP (verified in fiscalAnchors1991.test.ts).
 *   - Annual average, not January: it is the convention of the sibling 1991
 *     tables (UK, JP, DE, IE, CN) and the only one that makes local GDP over
 *     the rate equal the published dollar GDP. Turkey is the case where the two
 *     differ most (about 66 percent inflation through the year).
 *   - Sweden's and Turkey's general-government gross debt, and Turkey's general
 *     government expenditure, are not in the IMF series for 1991. Those fields
 *     are null and the seed keeps its authored fiscal ratio for them.
 */

export type FiscalAnchorCountry1991 = "FR" | "IT" | "ES" | "SE" | "TR" | "GR" | "AT" | "FI";

export interface FiscalAnchor1991 {
  readonly currencyCode: string;
  /** WDI NY.GDP.MKTP.CN as published (euro for euro members, new lira for TR). */
  readonly wdiGdpLcu: number;
  /** Legacy currency units per one WDI-published unit. */
  readonly legacyPerWdiUnit: number;
  /** WDI NY.GDP.MKTP.CD, US dollars. */
  readonly wdiGdpUsd: number;
  /** WDI PA.NUS.FCRF 1991 period average, legacy units per US dollar. */
  readonly lcuPerUsd: number;
  /** WDI NY.GDP.MKTP.KD.ZG, percent. */
  readonly realGrowthPct: number;
  /** WDI FP.CPI.TOTL.ZG, percent. */
  readonly cpiInflationPct: number;
  /** IMF WEO general government total expenditure, percent of GDP, or null. */
  readonly govExpenditurePctGdp: number | null;
  /** IMF WEO general government gross debt, percent of GDP, or null. */
  readonly govGrossDebtPctGdp: number | null;
}

export const FISCAL_ANCHORS_1991: Readonly<Record<FiscalAnchorCountry1991, FiscalAnchor1991>> = {
  FR: {
    currencyCode: "FRF",
    wdiGdpLcu: 1_082_833_000_000,
    legacyPerWdiUnit: 6.55957,
    wdiGdpUsd: 1_258_961_748_633.88,
    lcuPerUsd: 5.64211666666667,
    realGrowthPct: 1.23666248297356,
    cpiInflationPct: 3.21340732409677,
    govExpenditurePctGdp: 52.7,
    govGrossDebtPctGdp: 37.8,
  },
  IT: {
    currencyCode: "ITL",
    wdiGdpLcu: 800_293_526_000,
    legacyPerWdiUnit: 1936.27,
    wdiGdpUsd: 1_249_092_439_519.28,
    lcuPerUsd: 1240.61333333333,
    realGrowthPct: 1.53844759206665,
    cpiInflationPct: 6.24999929790291,
    govExpenditurePctGdp: 55.3,
    govGrossDebtPctGdp: 105.3,
  },
  ES: {
    currencyCode: "ESP",
    wdiGdpLcu: 360_182_812_000,
    legacyPerWdiUnit: 166.386,
    wdiGdpUsd: 576_753_902_321.857,
    lcuPerUsd: 103.911583333333,
    realGrowthPct: 2.54600049647455,
    cpiInflationPct: 5.9342134433593,
    govExpenditurePctGdp: 42.6,
    govGrossDebtPctGdp: 41.9,
  },
  SE: {
    currencyCode: "SEK",
    wdiGdpLcu: 1_655_995_782_000,
    legacyPerWdiUnit: 1,
    wdiGdpUsd: 273_831_464_572.137,
    lcuPerUsd: 6.04746666666666,
    realGrowthPct: -1.14597485051154,
    cpiInflationPct: 9.44462732944189,
    govExpenditurePctGdp: 61.2,
    govGrossDebtPctGdp: null,
  },
  TR: {
    currencyCode: "TRL",
    wdiGdpLcu: 630_116_900,
    legacyPerWdiUnit: 1_000_000,
    wdiGdpUsd: 151_034_731_543.624,
    lcuPerUsd: 4171.81583333333,
    realGrowthPct: 0.720279039109613,
    cpiInflationPct: 65.978567991895,
    govExpenditurePctGdp: null,
    govGrossDebtPctGdp: null,
  },
  GR: {
    currencyCode: "GRD",
    wdiGdpLcu: 55_458_894_000,
    legacyPerWdiUnit: 340.75,
    wdiGdpUsd: 103_680_863_712.844,
    lcuPerUsd: 182.266416666667,
    realGrowthPct: 3.09999970633838,
    cpiInflationPct: 19.4558456445745,
    govExpenditurePctGdp: 35.2,
    govGrossDebtPctGdp: 75.7,
  },
  AT: {
    currencyCode: "ATS",
    wdiGdpLcu: 146_886_762_000,
    legacyPerWdiUnit: 13.7603,
    wdiGdpUsd: 173_113_449_616.971,
    lcuPerUsd: 11.6759166666667,
    realGrowthPct: 3.44162748808654,
    cpiInflationPct: 3.33742703474792,
    govExpenditurePctGdp: 47.9,
    govGrossDebtPctGdp: 56.4,
  },
  FI: {
    currencyCode: "FIM",
    wdiGdpLcu: 86_913_000_000,
    legacyPerWdiUnit: 5.94573,
    wdiGdpUsd: 127_794_441_993.824,
    lcuPerUsd: 4.04397916666667,
    realGrowthPct: -5.88059618513641,
    cpiInflationPct: 4.31021289843461,
    govExpenditurePctGdp: 55.8,
    govGrossDebtPctGdp: 21.9,
  },
};

/** 1991 nominal GDP in the country's legacy currency, absolute units. */
export function gdp1991LegacyLcu(country: FiscalAnchorCountry1991): number {
  const a = FISCAL_ANCHORS_1991[country];
  return a.wdiGdpLcu * a.legacyPerWdiUnit;
}

/** The eight countries, in a stable order. */
export const FISCAL_ANCHOR_COUNTRIES_1991: readonly FiscalAnchorCountry1991[] = [
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
];
