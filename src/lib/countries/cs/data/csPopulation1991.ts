/**
 * Czechoslovak 3 March 1991 census population for the four game regions.
 * The Czech Statistical Office reports its former regions to 0.1 thousand;
 * Bohemia combines Central, South, West, North and East Bohemia, while Moravia
 * combines South and North Moravia. Prague is shown at the same precision so
 * the four rows use one basis. Slovakia's published republic total is exact.
 * Czech source, table "Počty a přírůstky obyvatel v jednotlivých krajích":
 * https://csu.gov.cz/docs/107516/8b7f8316-b655-b888-d475-50e8ee579a3c/2501_I_2.pdf?version=1.0
 * Slovak source: https://slovak.statistics.sk/wps/wcm/connect/fd3d3ef2-7970-48f6-a9ba-6ca50821f72b/2_Municipalities_and_resident_population_2001_1991.pdf?CVID=kojHSHF&MOD=AJPERES
 */
export const CS_1991_REGION_POPULATION = {
  CS_PRG: 1_214_200,
  CS_BOH: 1_112_900 + 697_500 + 860_300 + 1_174_000 + 1_233_200,
  CS_MOR: 2_049_400 + 1_960_700,
  CS_SVK: 5_274_335,
} as const;

export const CS_1991_POPULATION = Object.values(CS_1991_REGION_POPULATION).reduce(
  (sum, population) => sum + population,
  0
);
