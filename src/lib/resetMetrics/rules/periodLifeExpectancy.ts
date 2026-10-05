/** Period life expectancy implied by the same mortality curve used for cohorts. */
import {
  healthcareMortalityModifier,
  perAgeMortality,
  type HealthcareInputs,
} from "@/lib/demographics/flows/mortality";

export function periodLifeExpectancy(healthcare: HealthcareInputs): number {
  const modifier = healthcareMortalityModifier(healthcare);
  let combined = 0;
  for (const sex of ["male", "female"] as const) {
    let survivors = 1;
    let personYears = 0;
    for (let age = 0; age < 100; age += 1) {
      const annualDeathProbability = Math.min(1, perAgeMortality(sex, age) * modifier);
      personYears += survivors * (1 - annualDeathProbability / 2);
      survivors *= 1 - annualDeathProbability;
    }
    const terminalProbability = Math.min(1, perAgeMortality(sex, 100) * modifier);
    personYears += survivors / terminalProbability;
    combined += personYears;
  }
  return combined / 2;
}
