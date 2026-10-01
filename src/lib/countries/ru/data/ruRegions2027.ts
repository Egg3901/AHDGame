import type { State } from "@/lib/db/types";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { RU_ALL_AGE_CENSUS_2021 } from "./ruAdultCensus2021";

/** Russian Federation regions (2027) — presidential federation. The latest
 *  national anchors available for this future preset are Rosstat's 1 Jan 2025
 *  usually-resident population estimate (146,119,928) and Rosstat's revised
 *  2024 nominal GDP (RUB 201,152,000 million, 4.3% real growth; first
 *  estimate was RUB 200,039,500 million at 4.1%).
 *  https://eng.rosstat.gov.ru/storage/mediabank/Russia%202025.pdf
 *  https://www.interfax.com/newsroom/top-stories/109666/
 *  https://wabx.net/2025/04/11/russia-raises-2024-gdp-growth-figure-to-4-3/
 *  These ten regional figures are proportional estimates, reconciled exactly
 *  to those national anchors; they are not published Rosstat 2025 regional
 *  observations. Population uses the 2021 Rosstat census macroregion shares
 *  (`ruAdultCensus2021.ts`, all-age table), scaled to the 2025 national anchor
 *  by largest remainder. This holds each region's 2021 share fixed; it does
 *  not estimate subsequent regional migration or births. GDP shares follow
 *  the 1995 GRP weights (`ruRegionalGdp1991.ts`), the earliest published
 *  regional output table. GDP is millions of rubles.
 *
 *  Same ten RSFSR economic-region ids as 1991 (CEN / NWR / NOR / CBE / VOL /
 *  NCA / URA / WSB / ESB / FEA), so the Layer-1 census keys keep resolving.
 *  Kazakhstan, Transcaucasia, Central Asia and Moldova from the 1979 USSR
 *  bundle are sovereign states, not Russian regions, and stay excluded.
 *  houseDistricts = State Duma seats apportioned by population, largest
 *  remainder (sum = 450, the post-1993 Duma total: 225 single-member plus
 *  225 party-list seats, 5% threshold).
 *  stateSenateSeats = Federation Council seats at 2 per federal subject,
 *  grouped by economic macro-region (sum = 178 for 89 subjects): CEN 13,
 *  NWR 5, NOR 6, CBE 5, VOL 13, NCA 16, URA 7, WSB 9, ESB 6, FEA 9. NCA
 *  groups the Southern Federal District subjects (Rostov, Krasnodar,
 *  Stavropol, Adygea, Karachay-Cherkessia, Kabardino-Balkaria, North
 *  Ossetia, Ingushetia, Chechnya, Dagestan, Crimea, Sevastopol) with the
 *  four subjects Rosstat counts in its published national total; Buryatia
 *  and Zabaykalsky stay in ESB under the economic-region classification
 *  used since 1991. The Council is delegated, not population-apportioned;
 *  the per-region counts are the game's seat ledger, not an electoral rule.
 *  votingSystem reads `fptp` like every other 2027 bundle: the Duma's
 *  single-member tier is plurality, the list tier is PR, and the field
 *  cannot express a mixed system.
 */
const RU_2027_POPULATION: Record<string, number> = apportionSeats(
  146_119_928,
  RU_ALL_AGE_CENSUS_2021
);

const RU_2027_GDP_MRUB: Record<string, number> = {
  CEN: 42_165_006,
  NWR: 9_828_608,
  NOR: 10_812_687,
  CBE: 8_472_003,
  VOL: 30_270_591,
  NCA: 12_713_310,
  URA: 29_347_739,
  WSB: 31_211_081,
  ESB: 14_676_737,
  FEA: 11_654_238,
};

const RU_2027_SENATE_SEATS: Record<string, number> = {
  CEN: 26,
  NWR: 10,
  NOR: 12,
  CBE: 10,
  VOL: 26,
  NCA: 32,
  URA: 14,
  WSB: 18,
  ESB: 12,
  FEA: 18,
};

const RU_2027_NAMES: Record<string, { name: string; region: string }> = {
  CEN: { name: "Central Russia", region: "Russia" },
  NWR: { name: "Northwest Russia", region: "Russia" },
  NOR: { name: "European North", region: "Russia" },
  CBE: { name: "Central Black Earth", region: "Russia" },
  VOL: { name: "Volga", region: "Russia" },
  NCA: { name: "North Caucasus", region: "Russia" },
  URA: { name: "Urals", region: "Russia" },
  WSB: { name: "West Siberia", region: "Russia" },
  ESB: { name: "East Siberia", region: "Russia" },
  FEA: { name: "Russian Far East", region: "Russia" },
};

const dumaSeats = apportionSeats(450, RU_2027_POPULATION);

export const ruRegions2027: State[] = Object.keys(RU_2027_POPULATION).map((id) => ({
  _id: id,
  countryId: "RU",
  regionType: "state",
  name: RU_2027_NAMES[id].name,
  population: RU_2027_POPULATION[id],
  gdp: RU_2027_GDP_MRUB[id],
  houseDistricts: dumaSeats[id],
  stateSenateSeats: RU_2027_SENATE_SEATS[id],
  region: RU_2027_NAMES[id].region,
  votingSystem: "fptp",
}));

export default ruRegions2027;
