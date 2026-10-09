/**
 * Dated age-only adult shapes for 1991 cohort stocks in countries that have no
 * supported 1991 census bundle (#3369).
 *
 * Two source families, both national (or successor-state) totals:
 * - eurostat: demo_pjan, 1 January 1991, total sex, single-year counts.
 *   Bands 18-29, 30-44, 45-64, 65+ where 65+ adds the open age group.
 * - wdi: World Bank WDI (source 2) 1991 midyear, built from the UN World
 *   Population Prospects estimates of five-year age shares by sex times the
 *   male and female totals. 18-29 takes 40% of the 15-19 band (ages 18 and 19)
 *   under a uniform-within-band assumption. These are model estimates, not
 *   census observations.
 *
 * Each shape is applied to existing aggregate regions as an explicit proxy.
 * It is not a regional observation, the source totals never replace the
 * independently seeded regional populations, and no ethnicity, education,
 * income or urbanization profile is inferred.
 */
export type CohortAdultCounts = { young: number; mid: number; mature: number; senior: number };

export interface CohortAgeSource1991 {
  family: "eurostat" | "wdi";
  geo: string;
  adultCounts: CohortAdultCounts;
  sourcePopulation: number;
  referenceDate: "1991-01-01" | "1991-07-01";
  revision: string;
  retrievedAt: "2026-10-07";
}

const EUROSTAT_REVISION = "2026-09-25T23:00:00+0200";
const WDI_REVISION = "2026-07-13";

export const COHORT_AGE_SOURCE_URLS_1991 = {
  eurostat:
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo={geo}&time=1991&sex=T&unit=NR",
  wdi: "https://api.worldbank.org/v2/country/{geo}/indicator/SP.POP.TOTL.{MA|FE}.IN;SP.POP.{band}.{MA|FE}.5Y?source=2&date=1991&format=json",
} as const;

const eurostat = (geo: string, c: CohortAdultCounts, total: number): CohortAgeSource1991 => ({
  family: "eurostat",
  geo,
  adultCounts: c,
  sourcePopulation: total,
  referenceDate: "1991-01-01",
  revision: EUROSTAT_REVISION,
  retrievedAt: "2026-10-07",
});
const wdi = (geo: string, c: CohortAdultCounts, total: number): CohortAgeSource1991 => ({
  family: "wdi",
  geo,
  adultCounts: c,
  sourcePopulation: total,
  referenceDate: "1991-07-01",
  revision: WDI_REVISION,
  retrievedAt: "2026-10-07",
});

export const COHORT_AGE_SOURCES_1991: Record<string, CohortAgeSource1991> = {
  EUROSTAT_PL: eurostat(
    "PL",
    { young: 6204637, mid: 9286727, mature: 7488865, senior: 3884219 },
    38183160
  ),
  EUROSTAT_CZ: eurostat(
    "CZ",
    { young: 1680890, mid: 2336474, mature: 2257883, senior: 1302058 },
    10304607
  ),
  EUROSTAT_SK: eurostat(
    "SK",
    { young: 931004, mid: 1210085, mature: 1010780, senior: 551395 },
    5310711
  ),
  EUROSTAT_HU: eurostat(
    "HU",
    { young: 1599285, mid: 2339351, mature: 2449578, senior: 1395682 },
    10373153
  ),
  EUROSTAT_RO: eurostat(
    "RO",
    { young: 4137348, mid: 4893283, mature: 5171691, senior: 2447018 },
    23192274
  ),
  EUROSTAT_BG: eurostat(
    "BG",
    { young: 1382363, mid: 1845393, mature: 2142170, senior: 1160967 },
    8669269
  ),
  EUROSTAT_IT: eurostat(
    "IT",
    { young: 10894370, mid: 11783763, mature: 13718315, senior: 8555996 },
    56744119
  ),
  EUROSTAT_AT: eurostat(
    "AT",
    { young: 1543722, mid: 1640746, mature: 1734283, senior: 1153382 },
    7710882
  ),
  EUROSTAT_FI: eurostat(
    "FI",
    { young: 839958, mid: 1229867, mature: 1107631, senior: 672965 },
    4998478
  ),
  EUROSTAT_EL: eurostat(
    "EL",
    { young: 1821053, mid: 2077035, mature: 2528845, senior: 1415353 },
    10272691
  ),
  EUROSTAT_SI: eurostat(
    "SI",
    { young: 362166, mid: 470084, mature: 451669, senior: 216343 },
    1999945
  ),
  WDI_RUS: wdi(
    "RUS",
    { young: 24947373, mid: 35747541, mature: 32393371, senior: 15354275 },
    148394216
  ),
  WDI_UKR: wdi(
    "UKR",
    { young: 9059395, mid: 11313920, mature: 12077444, senior: 6389697 },
    52170961
  ),
  WDI_BLR: wdi("BLR", { young: 1745365, mid: 2291361, mature: 2263304, senior: 1116113 }, 10194050),
  WDI_EST: wdi("EST", { young: 260290, mid: 343269, mature: 363073, senior: 184611 }, 1561314),
  WDI_LVA: wdi("LVA", { young: 455971, mid: 549257, mature: 649767, senior: 318548 }, 2650581),
  WDI_LTU: wdi("LTU", { young: 683791, mid: 778239, mature: 835973, senior: 410530 }, 3704134),
  WDI_MDA: wdi("MDA", { young: 518871, mid: 683593, mature: 558274, senior: 256733 }, 2981566),
  WDI_GEO: wdi("GEO", { young: 894249, mid: 1013297, mature: 1032276, senior: 444010 }, 4835900),
  WDI_ARM: wdi("ARM", { young: 754048, mid: 800405, mature: 593016, senior: 192172 }, 3613977),
  WDI_AZE: wdi("AZE", { young: 1637896, mid: 1413872, mature: 1054151, senior: 299816 }, 7271300),
  WDI_KAZ: wdi("KAZ", { young: 3512451, mid: 3736135, mature: 2640289, senior: 1009606 }, 17278600),
  WDI_TKM: wdi("TKM", { young: 835961, mid: 661896, mature: 399353, senior: 138630 }, 3855894),
  WDI_UZB: wdi("UZB", { young: 4557936, mid: 3479059, mature: 2531644, senior: 755205 }, 20962910),
  WDI_TJK: wdi("TJK", { young: 1175330, mid: 849282, mature: 554114, senior: 194541 }, 5541205),
  WDI_KGZ: wdi("KGZ", { young: 927033, mid: 820063, mature: 559622, senior: 221339 }, 4463634),
  WDI_HRV: wdi("HRV", { young: 797021, mid: 1081621, mature: 1143061, senior: 558744 }, 4689022),
  WDI_BIH: wdi("BIH", { young: 914747, mid: 1007466, mature: 926910, senior: 306389 }, 4458343),
  WDI_SRB: wdi("SRB", { young: 1216831, mid: 1767720, mature: 1965431, senior: 890525 }, 7595636),
  WDI_XKX: wdi("XKX", { young: 453791, mid: 337996, mature: 256273, senior: 84065 }, 2005362),
  WDI_MNE: wdi("MNE", { young: 118933, mid: 131825, mature: 122103, senior: 50107 }, 607105),
  WDI_MKD: wdi("MKD", { young: 398845, mid: 465053, mature: 385435, senior: 152360 }, 2055994),
};

/** National shape per game country. Yugoslavia has none: every region uses its own successor-state source. */
export const COHORT_NATIONAL_SOURCE_1991: Record<string, string> = {
  RU: "WDI_RUS",
  PL: "EUROSTAT_PL",
  CS: "EUROSTAT_CZ",
  HU: "EUROSTAT_HU",
  RO: "EUROSTAT_RO",
  BG: "EUROSTAT_BG",
  IT: "EUROSTAT_IT",
  AT: "EUROSTAT_AT",
  FI: "EUROSTAT_FI",
  GR: "EUROSTAT_EL",
};

/**
 * Region overrides. Union republics use their successor state, Slovakia its own
 * shape, and each Yugoslav region its successor state. Vojvodina borrows the
 * Serbia estimate, which excludes Kosovo.
 */
export const COHORT_REGION_SOURCE_1991: Record<string, { countryId: string; source: string }> = {
  SU_UKR: { countryId: "RU", source: "WDI_UKR" },
  SU_BLR: { countryId: "RU", source: "WDI_BLR" },
  SU_EE: { countryId: "RU", source: "WDI_EST" },
  SU_LV: { countryId: "RU", source: "WDI_LVA" },
  SU_LT: { countryId: "RU", source: "WDI_LTU" },
  SU_MD: { countryId: "RU", source: "WDI_MDA" },
  SU_GE: { countryId: "RU", source: "WDI_GEO" },
  SU_AM: { countryId: "RU", source: "WDI_ARM" },
  SU_AZ: { countryId: "RU", source: "WDI_AZE" },
  SU_KZ: { countryId: "RU", source: "WDI_KAZ" },
  SU_TM: { countryId: "RU", source: "WDI_TKM" },
  SU_UZ: { countryId: "RU", source: "WDI_UZB" },
  SU_TJ: { countryId: "RU", source: "WDI_TJK" },
  SU_KG: { countryId: "RU", source: "WDI_KGZ" },
  CS_SVK: { countryId: "CS", source: "EUROSTAT_SK" },
  YU_SLO: { countryId: "YU", source: "EUROSTAT_SI" },
  YU_CRO: { countryId: "YU", source: "WDI_HRV" },
  YU_BIH: { countryId: "YU", source: "WDI_BIH" },
  YU_SRB: { countryId: "YU", source: "WDI_SRB" },
  YU_VOJ: { countryId: "YU", source: "WDI_SRB" },
  YU_KOS: { countryId: "YU", source: "WDI_XKX" },
  YU_MNE: { countryId: "YU", source: "WDI_MNE" },
  YU_MKD: { countryId: "YU", source: "WDI_MKD" },
};
