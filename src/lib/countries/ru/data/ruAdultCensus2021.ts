/**
 * Rosstat 2020 census, conducted in October 2021. These are the 18+ urban and
 * rural counts aggregated from federal subjects to the game's ten economic
 * macroregions. The 18-34 cell is 18-19 (15-19 minus ages 15-17) plus the
 * published 20-24, 25-29 and 30-34 cells. All eight cells sum to the national
 * 18+ count of 119,466,511. Urban/rural is the census classification.
 *
 * Source: Rosstat census volume 2, table 2, "Population by age groups and sex
 * by subjects of the Russian Federation" (XLSX):
 * https://rosstat.gov.ru/storage/mediabank/Tom2_tab2_VPN-2020.xlsx
 * Subject-to-region assignment follows the economic-region classification in
 * ruPopulation1991.ts. For audit, these are the selected row numbers in
 * Rosstat volume 1 table 4, in the same subject order as volume 2 table 2:
 * https://rosstat.gov.ru/storage/mediabank/Tom1_tab-4_VPN-2020.xlsx
 * CEN 9-10,12-14,17-20,22-25; NWR 34-35,37-39; NOR 27-29,33,36;
 * CBE 8,11,15-16,21; VOL 42,45-46,59-61,63,65-66,68-71;
 * NCA 41,43-44,47-48,50-56; URA 58,62,64,67,73-74,80;
 * WSB 75,82,85,88-91; ESB 83-84,86-87,93,95; FEA 94,96-103.
 * Nested autonomous okrugs are included in their parent oblast once.
 * The two federal cities have no rural rows. Crimea/Sevastopol
 * are included in NCA as in the source. The four territories claimed in 2022
 * have no rows in this census and are not imputed here.
 *
 * This is a 2021 structural snapshot for the 2027 game, not a claim that
 * regional adult composition was measured in 2027.
 */
export const RU_ADULT_CENSUS_2021 = {
  CEN: [6168373, 7161420, 5708852, 4905546, 912016, 1146739, 1118212, 862964],
  NWR: [1850892, 2137171, 1734896, 1490538, 237584, 296440, 272361, 211450],
  NOR: [617417, 803809, 629507, 514144, 139032, 188096, 223318, 158218],
  CBE: [956641, 1098177, 950920, 826488, 436095, 514391, 582745, 470849],
  VOL: [3543143, 4073329, 3414909, 2931969, 1050891, 1188328, 1396494, 1027605],
  NCA: [3119487, 3158122, 2348441, 1902558, 2233135, 2147287, 1953714, 1343870],
  URA: [2868376, 3265187, 2571634, 2214146, 867041, 1033237, 1165450, 806337],
  WSB: [2355151, 2725676, 2073755, 1621915, 595816, 784880, 774469, 555633],
  ESB: [1294531, 1455707, 1051056, 853560, 415663, 473264, 426172, 280442],
  FEA: [1027297, 1151825, 851655, 669091, 295544, 308521, 280285, 194612],
} as const;

export const RU_ADULT_COHORT_IDS = [
  "urban_18_34",
  "urban_35_49",
  "urban_50_64",
  "urban_65_plus",
  "rural_18_34",
  "rural_35_49",
  "rural_50_64",
  "rural_65_plus",
] as const;
