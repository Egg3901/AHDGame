import type { State } from "@/lib/db/types";
import { SOVIET_REPUBLIC_REFERENCE_1990 } from "@/lib/seeds/reference/sovietRepublics1990";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { ruRegions1991 } from "./ruRegions1991";

/**
 * The RU slot is the whole Soviet Union at the 1991 opening. Its ten RSFSR
 * economic regions retain their 1991 anchors; the other fourteen union
 * republics are bounded aggregate regions under the same federal issuer.
 * Their populations are January 1990 observations and their output is a
 * transparent proxy from 1988 net-material-product shares against the Russian
 * 1991 ruble anchor. This is not a claim of observed republic GDP in 1991.
 *
 * The 1989 USSR Congress seated 2,250 deputies: 1,500 district seats and 750
 * public-organization seats. The game has one regional seat ledger, so this
 * opening allocation distributes all 2,250 seats by population as a bounded
 * representation. It must not be presented as the historical constituency map.
 * https://data.ipu.org/election-summary/PDF/USSR_1989.PDF
 * https://thedocs.worldbank.org/en/doc/571751632222790357-0560011991/original/WorldBankGroupArchivesFolder30382302.pdf
 */
const republicRows = Object.entries(SOVIET_REPUBLIC_REFERENCE_1990).filter(
  ([entityId]) => entityId !== "RU"
);
const russianGdpMillionRub = SUCCESSOR_NOMINAL_GDP_1991.RU / 1_000_000;

const republicRegions: State[] = republicRows.map(([entityId, reference]) => ({
  _id: `SU_${entityId}`,
  countryId: "RU",
  regionType: "state",
  name: reference.name,
  region: "Union republics",
  population: reference.population,
  gdp: (russianGdpMillionRub * reference.nmpShareBps) / 6_110,
  houseDistricts: 0,
  stateSenateSeats: 0,
  votingSystem: "fptp",
}));

const populations = Object.fromEntries(
  [...ruRegions1991, ...republicRegions].map((region) => [region._id, region.population])
);
const seats = apportionSeats(2_250, populations);

export const sovietUnionRegions1991: State[] = [...ruRegions1991, ...republicRegions].map(
  (region) => ({ ...region, houseDistricts: seats[region._id], stateSenateSeats: 0 })
);

export const SOVIET_UNION_1991_POPULATION = sovietUnionRegions1991.reduce(
  (total, region) => total + region.population,
  0
);

export const SOVIET_UNION_1991_GDP_MILLION_RUB = sovietUnionRegions1991.reduce(
  (total, region) => total + region.gdp,
  0
);
