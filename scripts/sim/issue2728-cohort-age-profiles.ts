/** Portable source/profile and48-turn cohort qualification, with no database. */
import assert from "node:assert/strict";
import { cohortAgeShares1991 } from "../../src/lib/seeds/rules/cohortAgeShares1991";
import { COHORT_AGE_PROFILES_1991 } from "../../src/lib/seeds/reference/cohortAgeProfiles1991";
import { frRegions1991 } from "../../src/lib/countries/fr/data/frRegions1991";
import { esRegions1991 } from "../../src/lib/countries/es/data/esRegions1991";
import { synthesizeAgeSexVector } from "../../src/lib/demographics/seedSynthesis";
import { advanceCohort } from "../../src/lib/demographics/cohortFlows";
import { totalPopulation, type AgeSexVector } from "../../src/lib/demographics/cohortVector";

const cases: Array<{
  country: string;
  region: string;
  sourceDate: string;
  sourcePopulation: number;
  targetPopulation: number;
  openingPeople: number;
  after48Turns: number;
  stockFlowReconciled: boolean;
}> = [];
for (const [country, regions] of [
  ["FR", frRegions1991],
  ["ES", esRegions1991],
] as const) {
  const profile = COHORT_AGE_PROFILES_1991[country];
  assert.deepEqual(regions.map((row) => row._id).sort(), [...profile.regionIds].sort());
  assert.equal(
    Object.values(profile.adultCounts).reduce((sum, value) => sum + value, 0),
    profile.adultPopulation
  );
  for (const region of regions) {
    const shares = cohortAgeShares1991(country, region._id, "1991-default");
    assert(shares);
    let vector: AgeSexVector = synthesizeAgeSexVector({
      adultShares: shares,
      medianAge: 38,
      birthRate: 50,
      population: region.population,
    });
    vector = { male: vector.male.map(Math.round), female: vector.female.map(Math.round) };
    const opening = totalPopulation(vector);
    assert(Math.abs(opening - region.population) <= 101, region._id);
    for (let turn = 1; turn <= 48; turn++) {
      const before = totalPopulation(vector);
      const next = advanceCohort(
        vector,
        {
          replacementTFR: 2.06,
          birthRateIndex: 50,
          healthcare: { lifeExpectancy: 50, preventableMortality: 50 },
          netInternationalMigrants: 0,
          migrantShareMale: 0.5,
        },
        turn,
        48
      );
      vector = next.vector;
      assert(
        [...vector.male, ...vector.female].every((value) => Number.isFinite(value) && value >= 0),
        region._id
      );
      const expected = before + next.flows.births - next.flows.deaths + next.flows.netMigration;
      assert(Math.abs(totalPopulation(vector) - expected) < 0.00001, region._id);
    }
    cases.push({
      country,
      region: region._id,
      sourceDate: profile.referenceDate,
      sourcePopulation: profile.sourcePopulation,
      targetPopulation: region.population,
      openingPeople: opening,
      after48Turns: totalPopulation(vector),
      stockFlowReconciled: true,
    });
  }
}
console.log(
  JSON.stringify(
    {
      passed: cases.length,
      cases,
      scope:
        "National adult age proxies, existing youth/sex synthesis, neutral isolated cohort flows; no historical calibration or whole-world acceptance",
    },
    null,
    2
  )
);
