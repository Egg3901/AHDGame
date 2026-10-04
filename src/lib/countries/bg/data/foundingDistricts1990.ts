/**
 * The founding law specifies200 constituency seats and200 list seats in28 areas.
 * Census areas supply bounded population weights, not exact1990 boundaries.
 * https://www.ciela.net/svobodna-zona-darjaven-vestnik/document/2132293633/issue/1081/zakon-za-izbirane-na-veliko-narodno-sabranie
 */
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { BG_1991_MACROREGION_DISTRICTS, BG_1992_DISTRICT_POPULATION } from "./bgPopulation1991";

const labels: Readonly<Record<string, string>> = {
  Blagoevgrad: "Blagoevgrad",
  Burgas: "Burgas",
  Varna: "Varna",
  VelikoTurnovo: "Veliko Tarnovo",
  Vidin: "Vidin",
  Vratsa: "Vratsa",
  Gabrovo: "Gabrovo",
  Dobrich: "Dobrich",
  Kurdzhali: "Kardzhali",
  Kyustendil: "Kyustendil",
  Lovech: "Lovech",
  Montana: "Montana",
  Pazardzhik: "Pazardzhik",
  Pernik: "Pernik",
  Pleven: "Pleven",
  Plovdiv: "Plovdiv",
  Razgrad: "Razgrad",
  Ruse: "Ruse",
  Silistra: "Silistra",
  Sliven: "Sliven",
  Smolyan: "Smolyan",
  GradSofiya: "Sofia city",
  Sofiya: "Sofia province",
  StaraZagora: "Stara Zagora",
  Turgovishte: "Targovishte",
  Khaskovo: "Haskovo",
  Shumen: "Shumen",
  Yambol: "Yambol",
};

const districtCounts = apportionSeats(200, BG_1992_DISTRICT_POPULATION);
const listCounts = apportionSeats(200, BG_1992_DISTRICT_POPULATION);

export const BG_1990_LIST_DISTRICTS = Object.entries(BG_1991_MACROREGION_DISTRICTS).flatMap(
  ([regionId, districts]) =>
    districts.map((district) => ({
      id: `BG-grand-list-${district}`,
      censusDistrict: district,
      label: labels[district] ?? district,
      regionId,
      population: BG_1992_DISTRICT_POPULATION[district],
      seats: listCounts[district],
    }))
);

export const BG_1990_CONSTITUENCIES = BG_1990_LIST_DISTRICTS.flatMap((district) =>
  Array.from({ length: districtCounts[district.censusDistrict] }, (_, index) => ({
    id: `BG-grand-direct-${district.censusDistrict}-${index + 1}`,
    listDistrictId: district.id,
    districtNumber: index + 1,
    regionId: district.regionId,
    populationModel: "equal-census-area-subdivision" as const,
  }))
);

export const BG_1990_REGION_CAPACITY = BG_1990_LIST_DISTRICTS.reduce<Record<string, number>>(
  (regions, district) => {
    regions[district.regionId] =
      (regions[district.regionId] ?? 0) + district.seats + districtCounts[district.censusDistrict];
    return regions;
  },
  {}
);
