import type { AgeSexVector } from "@/lib/demographics/cohortVector";
import { asfrWeight } from "@/lib/demographics/flows/fertility";

/** Realized annual fertility on the total female cohort, including service constraints. */
export function realizedTfrFromBirths(
  before: AgeSexVector,
  birthsThisTurn: number,
  turnsPerYear: number
): number | null {
  if (!Number.isFinite(birthsThisTurn) || birthsThisTurn < 0) {
    throw new Error("realized fertility needs nonnegative births");
  }
  if (!Number.isSafeInteger(turnsPerYear) || turnsPerYear <= 0) {
    throw new Error("realized fertility needs a positive turn cadence");
  }
  if (before.female.length !== 101 || before.male.length !== 101) {
    throw new Error("realized fertility needs the canonical age vector");
  }
  let exposure = 0;
  for (let age = 18; age <= 44; age++) {
    const women = before.female[age];
    if (!Number.isFinite(women) || women < 0) {
      throw new Error(`invalid female cohort at age ${age}`);
    }
    exposure += women * asfrWeight(age);
  }
  return exposure > 0 ? (birthsThisTurn * turnsPerYear) / exposure : null;
}
