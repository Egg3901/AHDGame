import type { AgeSexVector } from "@/lib/demographics/cohortVector";

export interface OpeningDependencyCohorts {
  populationUnder15: number;
  population15To64: number;
  population65Plus: number;
}

/** The reset metric uses 15-64, unlike the legacy demographic 18-64 readout. */
export function openingDependencyCohorts(vector: AgeSexVector): OpeningDependencyCohorts {
  if (vector.male.length !== 101 || vector.female.length !== 101) {
    throw new Error("Opening cohort vector must contain ages 0-100 for both sexes.");
  }
  const groups: OpeningDependencyCohorts = {
    populationUnder15: 0,
    population15To64: 0,
    population65Plus: 0,
  };
  for (let age = 0; age <= 100; age++) {
    const male = vector.male[age];
    const female = vector.female[age];
    if (!Number.isFinite(male) || !Number.isFinite(female) || male < 0 || female < 0) {
      throw new Error(`Invalid opening cohort count at age ${age}.`);
    }
    const count = Math.round(male) + Math.round(female);
    if (age < 15) groups.populationUnder15 += count;
    else if (age < 65) groups.population15To64 += count;
    else groups.population65Plus += count;
  }
  return groups;
}

/** Live v2 dependency burden, preserving fractional cohort stocks. */
export function dependencyBurden15To64(vector: AgeSexVector): number | null {
  if (vector.male.length !== 101 || vector.female.length !== 101) {
    throw new Error("Dependency burden needs ages 0-100 for both sexes");
  }
  let dependent = 0;
  let working = 0;
  for (let age = 0; age <= 100; age++) {
    const male = vector.male[age];
    const female = vector.female[age];
    if (!Number.isFinite(male) || !Number.isFinite(female) || male < 0 || female < 0) {
      throw new Error(`Invalid live cohort count at age ${age}`);
    }
    const count = male + female;
    if (age < 15 || age >= 65) dependent += count;
    else working += count;
  }
  return working > 0 ? (dependent / working) * 100 : null;
}
