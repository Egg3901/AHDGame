/**
 * Population of the RSFSR on 1 January 1991, by the ten economic macroregions
 * used by the game. Values are sums of the constituent federal-subject rows in
 * Rosstat's 1990-1997 time series, published in thousands. The source gives
 * 148,164 thousand nationally; its thousand-person rounding is preserved.
 *
 * https://rosstat.gov.ru/bgd/regl/B06_16/IssWWW.exe/Stg/01-06n.htm
 * https://www.rosstat.gov.ru/bgd/regl/B03_13/IssWWW.exe/Stg/d010/i010620r.htm
 *
 * Assignment of subjects to economic regions follows the 1991 regional
 * classification. The game's Volga macroregion combines Volga-Vyatka and
 * Volga; Northwest includes Kaliningrad. Rosstat's 1991 Chechen-Ingush row
 * (1,302 thousand) is counted once in North Caucasus; its separately printed
 * Chechen subtotal (970 thousand) is not added again. Autonomous okrugs
 * nested in oblast totals are likewise not added again.
 *
 * These are Russian Federation regions only. Kazakhstan, Transcaucasia,
 * Central Asia and Moldova in the game's 1979 USSR bundle are excluded.
 */
export const RU_1991_ECONOMIC_REGION_POPULATION = {
  CEN: 30_279_000, // Central: Moscow city/oblast and 11 central oblasts
  NWR: 9_149_000, // St Petersburg, Leningrad, Novgorod, Pskov, Kaliningrad
  NOR: 6_162_000, // Karelia, Komi, Arkhangelsk, Vologda, Murmansk
  CBE: 7_753_000, // Belgorod, Voronezh, Kursk, Lipetsk, Tambov
  VOL: 25_082_000, // Volga-Vyatka plus Volga economic regions
  NCA: 16_909_000, // North Caucasus and Rostov
  URA: 20_401_000, // Urals including Bashkortostan, Udmurtia and Perm
  WSB: 15_123_000, // Western Siberia including Altai
  ESB: 9_240_000, // Eastern Siberia including Buryatia and Chita
  FEA: 8_066_000, // Far East including Sakha and Chukotka
} as const;

export const RU_1991_POPULATION = Object.values(RU_1991_ECONOMIC_REGION_POPULATION).reduce(
  (sum, population) => sum + population,
  0
);
