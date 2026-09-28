import type { State } from "@/lib/db/types";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * Six NUTS II statistical regions. Population: NSI, 31 December 2025;
 * GDP: NSI, 2024 current-price million BGN (latest regional release).
 * The 240 game seats are apportioned by population; actual parliamentary
 * elections use 31 multi-member constituencies, a separate engine gap.
 * https://www.nsi.bg/en/file/35195/population_and_demographic_processes%20EN.pdf
 * https://www.nsi.bg/en/statistical-data/141/429
 */
const rows = [
  ["BG31", "Northwestern", 647_273, 13_289],
  ["BG32", "North Central", 666_224, 14_132],
  ["BG33", "Northeastern", 826_624, 20_192],
  ["BG34", "Southeastern", 951_060, 25_958],
  ["BG41", "Southwestern", 2_026_014, 103_987],
  ["BG42", "South Central", 1_306_012, 27_349],
] as const;
const seats = apportionSeats(
  240,
  Object.fromEntries(rows.map(([id, , population]) => [id, population]))
);
export const bgRegions2027: State[] = rows.map(([id, name, population, gdp]) => ({
  _id: id,
  countryId: "BG",
  regionType: "region",
  name,
  population,
  gdp,
  houseDistricts: seats[id]!,
  stateSenateSeats: 0,
  region: name,
  votingSystem: "fptp",
}));
export default bgRegions2027;
