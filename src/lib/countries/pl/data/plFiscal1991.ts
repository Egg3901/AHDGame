/**
 * Poland's enacted FY1991 state budget, in millions of pre-1995 złoty.
 * The law was passed 23 February with effect from 1 January 1991. These are
 * authorised amounts, not the later cash outturn reported by the IMF.
 * Source: Republic of Poland, 1991 Budget Act, Article 1:
 * https://eli.gov.pl/api/acts/DU/1991/89/text.html
 */
export const PL_1991_BUDGET_LAW_MILLION_PLZ = {
  revenue: 289_168_478,
  expenditure: 293_474_478,
  deficit: 4_306_000,
  revenueBySource: {
    taxes: 216_826_200,
    interestAndDividends: 24_154_787,
    customs: 9_590_000,
    financialInstitutionProfits: 15_600_066,
    governmentFees: 2_907_263,
    socialAndCulturalServiceFees: 1_450_808,
    foreignDebtServiceReceipts: 190_000,
    stateAssetSalesAndLeases: 15_000_000,
    other: 3_449_354,
  },
  spendingByFunction: {
    economicSubsidies: 35_274_082,
    socialInsurance: 25_630_459,
    publicSector: 196_442_019,
    foreignTradeAndDebtService: 13_845_780,
    bankSettlements: 13_780_000,
    generalReserve: 1_020_000,
    municipalGrants: 7_482_138,
  },
  publicSectorBreakdown: {
    economicUnits: 25_034_392,
    science: 9_765_870,
    schools: 30_056_913,
    higherEducation: 7_728_576,
    culture: 3_422_026,
    healthSportTourism: 43_266_368,
    socialCare: 20_770_428,
    administration: 7_613_954,
    privatization: 2_950_000,
    justice: 3_697_620,
    publicSafety: 10_244_349,
    defense: 23_492_573,
    other: 4_001_006,
    earmarkedReserve: 4_397_944,
  },
} as const;

/**
 * World Bank WDI's revised 1991 nominal GDP is 90,485,640,500 in the
 * post-1995 złoty series. The world starts in 1991, when one new złoty still
 * represented 10,000 old złoty, so fiscal and GDP amounts must use the same
 * old-PLZ unit. The WDI exchange-rate series likewise reports 1.0576058333
 * new złoty per USD; multiplying by 10,000 gives the historical unit.
 * Source: WDI NY.GDP.MKTP.CN and PA.NUS.FCRF, Poland, 1991:
 * https://api.worldbank.org/v2/country/POL/indicator/NY.GDP.MKTP.CN?date=1991&format=json
 * https://api.worldbank.org/v2/country/POL/indicator/PA.NUS.FCRF?date=1991&format=json
 * The January 1991 fixed exchange rate was 9,500 old złoty per USD; the WDI
 * rate is the annual average after the May devaluation. Source: IMF WP/92/86:
 * https://www.elibrary.imf.org/view/journals/001/1992/086/article-A001-en.xml
 */
export const PL_1991_NOMINAL_GDP_OLD_PLZ = 904_856_405_000_000;
export const PL_JANUARY_1991_PLZ_PER_USD = 9_500;
export const PL_1991_ANNUAL_AVERAGE_PLZ_PER_USD = 10_576.0583333333;

/**
 * IMF national-authority series for actual 1991 general-government operations,
 * percentage of GDP. It covers a wider perimeter than the state budget law.
 * Source: IMF WP/94/104, Table 1:
 * https://www.elibrary.imf.org/view/journals/001/1994/104/article-A001-en.xml
 */
export const PL_1991_GENERAL_GOVERNMENT_GDP_PERCENT = {
  revenue: 41.5,
  expenditure: 48.0,
  balance: -6.5,
} as const;
