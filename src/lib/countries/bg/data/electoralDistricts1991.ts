/**
 * Bulgaria's ordinary Assembly uses 31 electoral districts within five game
 * regions. This catalog supplies bounded district population weights, not a
 * reconstruction of the electoral commission's exact 1991 apportionment.
 * District identities: https://pi2005.cik.bg/camp_mandate.html
 * 1991 system: https://data.ipu.org/election-summary/PDF/BULGARIA_1991_E.PDF
 */
import { BG_1992_DISTRICT_POPULATION } from "./bgPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

type CensusDistrict = keyof typeof BG_1992_DISTRICT_POPULATION;
export interface BgElectoralDistrict {
  id: string;
  number: number;
  label: string;
  regionId: string;
  population: number;
  populationModel: "1992-census" | "equal-sofia-subdivision" | "plovdiv-city-proxy";
}

// NSI Statistical Yearbook 1992, printed page23/table7 (PDF page59):
// Plovdiv city has341374 residents at1992 year-end. This is a subdivision
// proxy within the existing census district, not an observed1991 district count.
// https://www.nsi.bg/sites/default/files/files/publications/God1992.pdf
const PLOVDIV_CITY_POPULATION_PROXY = 341_374;
const sofiaParts = apportionSeats(BG_1992_DISTRICT_POPULATION.GradSofiya, {
  "23": 1,
  "24": 1,
  "25": 1,
});
const definitions: ReadonlyArray<readonly [number, string, string, CensusDistrict, number?]> = [
  [1, "Blagoevgrad", "BG_SW", "Blagoevgrad"],
  [2, "Burgas", "BG_COA", "Burgas"],
  [3, "Varna", "BG_COA", "Varna"],
  [4, "Veliko Tarnovo", "BG_NOR", "VelikoTurnovo"],
  [5, "Vidin", "BG_NOR", "Vidin"],
  [6, "Vratsa", "BG_NOR", "Vratsa"],
  [7, "Gabrovo", "BG_NOR", "Gabrovo"],
  [8, "Dobrich", "BG_COA", "Dobrich"],
  [9, "Kardzhali", "BG_THR", "Kurdzhali"],
  [10, "Kyustendil", "BG_SW", "Kyustendil"],
  [11, "Lovech", "BG_NOR", "Lovech"],
  [12, "Montana", "BG_NOR", "Montana"],
  [13, "Pazardzhik", "BG_THR", "Pazardzhik"],
  [14, "Pernik", "BG_SW", "Pernik"],
  [15, "Pleven", "BG_NOR", "Pleven"],
  [16, "Plovdiv city", "BG_THR", "Plovdiv", PLOVDIV_CITY_POPULATION_PROXY],
  [
    17,
    "Plovdiv district",
    "BG_THR",
    "Plovdiv",
    BG_1992_DISTRICT_POPULATION.Plovdiv - PLOVDIV_CITY_POPULATION_PROXY,
  ],
  [18, "Razgrad", "BG_NOR", "Razgrad"],
  [19, "Ruse", "BG_NOR", "Ruse"],
  [20, "Silistra", "BG_NOR", "Silistra"],
  [21, "Sliven", "BG_THR", "Sliven"],
  [22, "Smolyan", "BG_THR", "Smolyan"],
  [23, "Sofia 1", "BG_SOF", "GradSofiya", sofiaParts["23"]],
  [24, "Sofia 2", "BG_SOF", "GradSofiya", sofiaParts["24"]],
  [25, "Sofia 3", "BG_SOF", "GradSofiya", sofiaParts["25"]],
  [26, "Sofia district", "BG_SOF", "Sofiya"],
  [27, "Stara Zagora", "BG_THR", "StaraZagora"],
  [28, "Targovishte", "BG_NOR", "Turgovishte"],
  [29, "Haskovo", "BG_THR", "Khaskovo"],
  [30, "Shumen", "BG_NOR", "Shumen"],
  [31, "Yambol", "BG_THR", "Yambol"],
];

export const BG_1991_ELECTORAL_DISTRICTS: readonly BgElectoralDistrict[] = definitions.map(
  ([number, label, regionId, censusDistrict, subdivision]) => ({
    id: `BG-electoral-${String(number).padStart(2, "0")}`,
    number,
    label,
    regionId,
    population: subdivision ?? BG_1992_DISTRICT_POPULATION[censusDistrict],
    populationModel:
      censusDistrict === "GradSofiya"
        ? "equal-sofia-subdivision"
        : censusDistrict === "Plovdiv"
          ? "plovdiv-city-proxy"
          : "1992-census",
  })
);
