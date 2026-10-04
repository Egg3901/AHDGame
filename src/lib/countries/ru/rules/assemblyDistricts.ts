/**
 * Russian Duma constituencies contest 225 individual seats within the game regions.
 * planRussianDumaDistricts freezes each district's share of regional registration;
 * its numbered boundaries are a game approximation, not historical constituencies.
 */
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

export interface RussianDumaDistrict {
  seatId: string;
  regionId: string;
  districtNumber: number;
  regionalDistrictCount: number;
  registeredVoters: number;
}

export function planRussianDumaDistricts(
  registeredByRegion: Readonly<Record<string, number>>
): RussianDumaDistrict[] {
  const regions = Object.keys(RU_1991_ECONOMIC_REGION_POPULATION);
  if (
    Object.keys(registeredByRegion).length !== regions.length ||
    regions.some(
      (region) =>
        !Object.prototype.hasOwnProperty.call(registeredByRegion, region) ||
        !Number.isSafeInteger(registeredByRegion[region]) ||
        registeredByRegion[region] < 0
    )
  )
    throw new Error("Duma districts need the complete frozen Russian regional register");
  const total = regions.reduce(
    (sum, region) => sum + BigInt(registeredByRegion[region]),
    BigInt(0)
  );
  if (total < BigInt(1) || total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("The Russian Duma electorate is empty or exceeds precision");
  const allocation = apportionSeats(225, RU_1991_ECONOMIC_REGION_POPULATION);
  return regions.flatMap((regionId) => {
    const count = allocation[regionId];
    const registered = registeredByRegion[regionId];
    const quotient = Number(BigInt(registered) / BigInt(count));
    const remainder = Number(BigInt(registered) % BigInt(count));
    return Array.from({ length: count }, (_, index) => ({
      seatId: `RU-duma-${regionId}-${index + 1}`,
      regionId,
      districtNumber: index + 1,
      regionalDistrictCount: count,
      registeredVoters: quotient + (index < remainder ? 1 : 0),
    }));
  });
}
