import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { RO_1991_MACROREGION_POPULATION } from "../data/roPopulation1991";

/** 1992 Electoral Bureau totals: 328 ordinary + 13 minority deputies, 143 senators. */
export const RO_1992_DEPUTY_SEATS = 341;
export const RO_1992_SENATE_SEATS = 143;
export const RO_1992_DEPUTIES_BY_REGION = apportionSeats(
  RO_1992_DEPUTY_SEATS,
  RO_1991_MACROREGION_POPULATION
);
export const RO_1992_SENATORS_BY_REGION = apportionSeats(
  RO_1992_SENATE_SEATS,
  RO_1991_MACROREGION_POPULATION
);

/** Founding restores the 1990 chamber; regular elections choose the 1992 size. */
export function roElectionSeatsForPreset(
  current: Readonly<Record<string, number>>,
  chamber: "deputies" | "senate",
  preset: string | undefined,
  founding: boolean
): Readonly<Record<string, number>> {
  if (preset !== "1991-default" || founding) return current;
  return chamber === "deputies" ? RO_1992_DEPUTIES_BY_REGION : RO_1992_SENATORS_BY_REGION;
}
