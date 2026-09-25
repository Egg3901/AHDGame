import type { State } from "@/lib/db/types";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * Poland regions (2027) — Third-Republic democracy. The eight game
 * macroregions are kept with their existing ids so the Layer-1 census keys
 * keep resolving; each is an explicit grouping of the 16 current
 * voivodeships, following the predecessor composition already recorded in
 * `./plPopulation1991.ts` (Bydgoszcz/Torun/Wloclawek are Pomorze there, and
 * they are Pomorze here).
 *
 * Population: GUS "Population. Size and structure and vital statistics in
 * Poland by territorial division in 2024. As of 31 December", tables in
 * thousands with one decimal (values below are x1,000):
 * https://stat.gov.pl/files/gfx/portalinformacyjny/en/defaultaktualnosci/3286/3/37/1/population_size_and_structure_and_vital_statistics_in_poland_by_territorial_division_in_31-12-2024.pdf
 * Mazowieckie 5508.3, Lodzkie 2345.9, Swietokrzyskie 1158.0, Malopolskie
 * 3429.1, Podkarpackie 2063.0, Slaskie 4291.4, Opolskie 930.3, Dolnoslaskie
 * 2868.2, Lubuskie 969.8, Wielkopolskie 3480.0, Pomorskie 2359.5,
 * Kujawsko-pomorskie 1984.5, Warminsko-mazurskie 1349.2,
 * Zachodniopomorskie 1622.8, Lubelskie 1996.4, Podlaskie 1132.6.
 * These sum to 37,489.0 thousand against the published 37,489.1 thousand
 * national total; the missing 100 people are a decimal-rounding remainder
 * and are carried on PL_MAZ below so the regional sum reconciles exactly.
 *
 * GDP: GUS "Provisional estimates of gross domestic product in regional
 * breakdown in 2024" (30.12.2025), current prices, millions of PLN. The
 * release splits Mazowieckie into Warszawski stoleczny 674,098 and
 * Mazowiecki regionalny 198,432; the remaining voivodeships read
 * Dolnoslaskie 302,269, Kujawsko-pomorskie 153,798, Lubelskie 135,033,
 * Lubuskie 76,040, Lodzkie 219,173, Malopolskie 297,163, Opolskie 71,313,
 * Podkarpackie 140,727, Podlaskie 82,373, Pomorskie 219,563, Slaskie
 * 419,348, Swietokrzyskie 84,575, Warminsko-mazurskie 90,396, Wielkopolskie
 * 359,824, Zachodniopomorskie 129,307:
 * https://publikacje.new.stat.gov.pl/en/file/197240/download?token=BYGP6Fty
 * The voivodeship figures sum exactly to the published national
 * 3,653,432, and the five largest (Warszawski stoleczny, Slaskie,
 * Wielkopolskie, Dolnoslaskie, Malopolskie) hold 56.2% between them, as
 * the release states. These are OBSERVED 2024 values grouped into game
 * regions, not a projection of 2027: the 2027 preset reuses the latest
 * completed observation as its anchor (2027 FALLBACK, not a 2027 forecast).
 *
 * houseDistricts = Sejm seats apportioned by population, largest remainder
 * (sum = 460). stateSenateSeats = Senate seats apportioned the same way
 * (sum = 100): a PROPORTIONAL FALLBACK, not the official 100
 * single-member constituency map, which does not follow macroregion
 * boundaries and is not modeled here.
 */
const PL_2027_MACROREGION_VOIVODESHIPS = {
  PL_MAZ: ["Mazowieckie"],
  PL_LOD: ["Lodzkie", "Swietokrzyskie"],
  PL_MAL: ["Malopolskie", "Podkarpackie"],
  PL_SLK: ["Slaskie", "Opolskie"],
  PL_DSL: ["Dolnoslaskie", "Lubuskie"],
  PL_WLK: ["Wielkopolskie"],
  PL_POM: ["Pomorskie", "Kujawsko-pomorskie", "Warminsko-mazurskie", "Zachodniopomorskie"],
  PL_EAS: ["Lubelskie", "Podlaskie"],
} as const;

/** GUS 31 December 2024 voivodeship population, in people. */
const PL_2027_VOIVODESHIP_POPULATION = {
  Mazowieckie: 5_508_300,
  Lodzkie: 2_345_900,
  Swietokrzyskie: 1_158_000,
  Malopolskie: 3_429_100,
  Podkarpackie: 2_063_000,
  Slaskie: 4_291_400,
  Opolskie: 930_300,
  Dolnoslaskie: 2_868_200,
  Lubuskie: 969_800,
  Wielkopolskie: 3_480_000,
  Pomorskie: 2_359_500,
  "Kujawsko-pomorskie": 1_984_500,
  "Warminsko-mazurskie": 1_349_200,
  Zachodniopomorskie: 1_622_800,
  Lubelskie: 1_996_400,
  Podlaskie: 1_132_600,
} as const;

/** GUS 2024 voivodeship GDP, current prices, in millions of PLN. */
const PL_2027_VOIVODESHIP_GDP_PLN_M = {
  Mazowieckie: 872_530,
  Lodzkie: 219_173,
  Swietokrzyskie: 84_575,
  Malopolskie: 297_163,
  Podkarpackie: 140_727,
  Slaskie: 419_348,
  Opolskie: 71_313,
  Dolnoslaskie: 302_269,
  Lubuskie: 76_040,
  Wielkopolskie: 359_824,
  Pomorskie: 219_563,
  "Kujawsko-pomorskie": 153_798,
  "Warminsko-mazurskie": 90_396,
  Zachodniopomorskie: 129_307,
  Lubelskie: 135_033,
  Podlaskie: 82_373,
} as const;

type Voivodeship = keyof typeof PL_2027_VOIVODESHIP_POPULATION;

function sumVoivodeships(
  regionId: keyof typeof PL_2027_MACROREGION_VOIVODESHIPS,
  table: Record<Voivodeship, number>
): number {
  return PL_2027_MACROREGION_VOIVODESHIPS[regionId].reduce<number>(
    (sum, name) => sum + table[name as Voivodeship],
    0
  );
}

const PL_2027_MACROREGION_POPULATION: Record<string, number> = Object.fromEntries(
  Object.keys(PL_2027_MACROREGION_VOIVODESHIPS).map((regionId) => [
    regionId,
    sumVoivodeships(
      regionId as keyof typeof PL_2027_MACROREGION_VOIVODESHIPS,
      PL_2027_VOIVODESHIP_POPULATION
    ) + (regionId === "PL_MAZ" ? 100 : 0),
  ])
);

const SEJM_SEATS_BY_MACROREGION = apportionSeats(460, PL_2027_MACROREGION_POPULATION);
const SENATE_SEATS_BY_MACROREGION = apportionSeats(100, PL_2027_MACROREGION_POPULATION);

const PL_2027_REGION_META = {
  PL_MAZ: { name: "Mazovia", region: "Mazovia" },
  PL_LOD: { name: "Łódź & Holy Cross", region: "Łódź" },
  PL_MAL: { name: "Lesser Poland", region: "Lesser Poland" },
  PL_SLK: { name: "Silesia", region: "Silesia" },
  PL_DSL: { name: "Lower Silesia", region: "Lower Silesia" },
  PL_WLK: { name: "Greater Poland", region: "Greater Poland" },
  PL_POM: { name: "Pomerania & Masuria", region: "Pomerania" },
  PL_EAS: { name: "Eastern Poland", region: "Eastern Poland" },
} as const;

export const plRegions2027: State[] = (
  Object.keys(PL_2027_MACROREGION_VOIVODESHIPS) as Array<
    keyof typeof PL_2027_MACROREGION_VOIVODESHIPS
  >
).map((regionId) => ({
  _id: regionId,
  countryId: "PL",
  regionType: "state",
  name: PL_2027_REGION_META[regionId].name,
  population: PL_2027_MACROREGION_POPULATION[regionId],
  gdp: sumVoivodeships(regionId, PL_2027_VOIVODESHIP_GDP_PLN_M),
  houseDistricts: SEJM_SEATS_BY_MACROREGION[regionId],
  stateSenateSeats: SENATE_SEATS_BY_MACROREGION[regionId],
  region: PL_2027_REGION_META[regionId].region,
  votingSystem: "fptp",
}));

export default plRegions2027;
