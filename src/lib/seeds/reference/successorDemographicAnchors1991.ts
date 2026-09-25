import { HU_1991_REGION_AGE } from "@/lib/countries/hu/data/huPopulation1991";

/**
 * 1991 age and urbanization controls. WDI age 0-14 / 65+ and urban share for
 * each country or Yugoslav successor republic are retrospective census-based
 * series. Czech and Slovak values are kept separate. Hungarian age shares use
 * KSH's exact 1 January 1990 regional counts; urban share is national WDI.
 * Other multi-region countries use national 1991 controls, with the region
 * deviation estimated in the transition model from 1991 GDP per resident.
 * YU_VOJ uses Serbia's age/urban series; Kosovo has its own WDI series.
 * WDI series (change country code for each row):
 * https://api.worldbank.org/v2/country/RUS/indicator/SP.POP.0014.TO.ZS?date=1991&format=json
 * https://api.worldbank.org/v2/country/RUS/indicator/SP.POP.65UP.TO.ZS?date=1991&format=json
 * https://api.worldbank.org/v2/country/RUS/indicator/SP.URB.TOTL.IN.ZS?date=1991&format=json
 * KSH: https://www.ksh.hu/docs/hun/xtabla/oregedes/tablto09_04.html
 */
export interface DemographicAnchor1991 {
  young: number;
  senior: number;
  urban: number;
}

export const NATIONAL_DEMOGRAPHIC_ANCHORS_1991 = {
  RU: { young: 22.7252, senior: 10.3469, urban: 73.7095 },
  PL: { young: 24.6363, senior: 10.2914, urban: 61.3709 },
  CS_CZE: { young: 20.8552, senior: 12.6652, urban: 75.1663 },
  CS_SVK: { young: 24.8055, senior: 10.3732, urban: 56.8272 },
  HU: { young: 19.6936, senior: 13.5931, urban: 61.3233 },
  RO: { young: 22.7627, senior: 10.8142, urban: 54.3127 },
  BG: { young: 19.8292, senior: 13.6355, urban: 67.088 },
} as const;

export const YU_REGION_DEMOGRAPHIC_ANCHORS_1991: Record<string, DemographicAnchor1991> = {
  YU_SLO: { young: 20.3066, senior: 10.9412, urban: 50.5271 },
  YU_CRO: { young: 19.5069, senior: 11.916, urban: 54.3475 },
  YU_BIH: { young: 24.2963, senior: 6.8723, urban: 39.6239 },
  YU_SRB: { young: 19.0559, senior: 11.7242, urban: 50.8152 },
  YU_VOJ: { young: 19.0559, senior: 11.7242, urban: 50.8152 },
  YU_KOS: { young: 37.0639, senior: 4.192, urban: 37.0274 },
  YU_MNE: { young: 25.3567, senior: 8.2535, urban: 49.0416 },
  YU_MKD: { young: 26.4904, senior: 7.4105, urban: 57.928 },
};

export function demographicAnchor1991(countryId: string, regionId: string): DemographicAnchor1991 {
  if (countryId === "YU") {
    const anchor = YU_REGION_DEMOGRAPHIC_ANCHORS_1991[regionId];
    if (!anchor) throw new Error(`Missing Yugoslav 1991 demographic anchor for ${regionId}`);
    return anchor;
  }
  if (countryId === "HU") {
    const counts = HU_1991_REGION_AGE[regionId as keyof typeof HU_1991_REGION_AGE];
    if (!counts) throw new Error(`Missing Hungarian 1990 regional age for ${regionId}`);
    const total = counts.young0to14 + counts.adult15to64 + counts.senior65Plus;
    return {
      young: (counts.young0to14 / total) * 100,
      senior: (counts.senior65Plus / total) * 100,
      urban: NATIONAL_DEMOGRAPHIC_ANCHORS_1991.HU.urban,
    };
  }
  const key = countryId === "CS" ? (regionId === "CS_SVK" ? "CS_SVK" : "CS_CZE") : countryId;
  const anchor =
    NATIONAL_DEMOGRAPHIC_ANCHORS_1991[key as keyof typeof NATIONAL_DEMOGRAPHIC_ANCHORS_1991];
  if (!anchor) throw new Error(`Missing 1991 demographic anchor for ${countryId}/${regionId}`);
  return anchor;
}
