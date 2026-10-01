/**
 * Dated national population anchors for six reconciled 1991 opening models.
 * National observations and estimates are separate from the game's estimated regional
 * shares. These data are pinned at retrieval, not refreshed during a reset or turn.
 */
export const POPULATION_TOTALS_1991 = {
  CN: {
    population: 1_158_230_000,
    referenceDate: "1991-12-31",
    basis: "NBS year-end estimate",
    scope: "Mainland China; excludes Hong Kong, Macao and Taiwan",
    regionalBasis:
      "Existing seven-region 1990-era model shares, normalized to the national anchor; estimated regional counts",
    source: "https://www.stats.gov.cn/sj/tjgb/ndtjgb/qgndtjgb/202302/t20230206_1901935.html",
  },
  NG: {
    population: 88_992_220,
    referenceDate: "1991 census",
    basis:
      "National Population Commission census total, reproduced by NBS Annual Abstract 2011 Table 12",
    scope: "Nigeria including FCT Abuja; six game zones include their full national share",
    regionalBasis:
      "Existing six-zone model shares, normalized by 20 people; zone estimates are not independently verified census aggregates",
    source: "https://nigerianstat.gov.ng/pdfuploads/Annual_Abstract_of_Statistics_2011.pdf",
  },
  FR: {
    population: 56_840_661,
    referenceDate: "1991-01-01",
    basis: "INSEE series 000067670 population estimate",
    scope: "Metropolitan France including Corsica; excludes overseas departments and territories",
    regionalBasis:
      "Existing eight-region 1979-era model shares carried forward as estimates, normalized to the 1991 national anchor",
    source: "https://www.insee.fr/en/statistiques/serie/000067670",
  },
  ES: {
    population: 38_966_376,
    referenceDate: "1991 midyear",
    basis: "World Bank WDI SP.POP.TOTL, source 2, revision 2026-07-13",
    scope:
      "Spain national resident population; islands and small territories absorbed into the aggregate region model",
    regionalBasis:
      "Existing eight-region 1979-era model shares carried forward as estimates, normalized to the 1991 national anchor",
    source: "https://api.worldbank.org/v2/country/ESP/indicator/SP.POP.TOTL?date=1991&format=json",
  },
  SE: {
    population: 8_617_375,
    referenceDate: "1991 midyear",
    basis: "World Bank WDI SP.POP.TOTL, source 2, revision 2026-07-13",
    scope: "Sweden national resident population; all eight game regions share the full total",
    regionalBasis:
      "Existing eight-region older model shares carried forward as estimates, normalized to the 1991 national anchor",
    source: "https://api.worldbank.org/v2/country/SWE/indicator/SP.POP.TOTL?date=1991&format=json",
  },
  TR: {
    population: 57_009_887,
    referenceDate: "1991 midyear",
    basis: "World Bank WDI SP.POP.TOTL, source 2, revision 2026-07-13",
    scope: "Turkey national resident population; excludes Northern Cyprus",
    regionalBasis:
      "Existing eight-region 1979-era model shares carried forward as estimates, normalized to the 1991 national anchor",
    source: "https://api.worldbank.org/v2/country/TUR/indicator/SP.POP.TOTL?date=1991&format=json",
  },
} as const;

export const POPULATION_TOTALS_1991_RETRIEVED_ON = "2026-09-30";
