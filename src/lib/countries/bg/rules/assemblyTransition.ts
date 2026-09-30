import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { BG_1991_MACROREGION_POPULATION } from "../data/bgPopulation1991";

/** The ordinary Assembly elected on 13 October 1991 first sat on 4 November. */
export const BG_ORDINARY_ASSEMBLY_START_TURN = 41;
export const BG_ORDINARY_ASSEMBLY_TOTAL_SEATS = 240;
export const BG_ORDINARY_ASSEMBLY_SEATS = apportionSeats(
  BG_ORDINARY_ASSEMBLY_TOTAL_SEATS,
  BG_1991_MACROREGION_POPULATION
);

export function bgAssemblyName(
  preset: string | undefined,
  ordinaryAssemblySinceTurn: number | undefined
): string {
  return preset === "1991-default" && ordinaryAssemblySinceTurn == null
    ? "Grand National Assembly"
    : "National Assembly";
}

/** The founding vote re-seats the 400-member Grand Assembly; regular votes elect 240. */
export function bgElectionSeatsForPreset(
  currentRegionSeats: Readonly<Record<string, number>>,
  preset: string | undefined,
  founding: boolean
): Readonly<Record<string, number>> {
  return preset === "1991-default" && !founding ? BG_ORDINARY_ASSEMBLY_SEATS : currentRegionSeats;
}

export function canOpenBgOrdinaryAssembly(
  calendarTurn: number,
  resolvedRegionalSeats: Readonly<Record<string, number>>
): boolean {
  if (calendarTurn < BG_ORDINARY_ASSEMBLY_START_TURN) return false;
  const expectedIds = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS);
  return (
    Object.keys(resolvedRegionalSeats).length === expectedIds.length &&
    expectedIds.every((id) => resolvedRegionalSeats[id] === BG_ORDINARY_ASSEMBLY_SEATS[id])
  );
}
