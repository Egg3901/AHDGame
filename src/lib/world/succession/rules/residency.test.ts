import { describe, expect, it } from "vitest";
import { planSuccessionResidency } from "./residency";

const territories = [
  { entityId: "RU", regionIds: ["CEN"], population: 10, annualGdpAnchor: 100 },
  { entityId: "UKR", regionIds: ["SU_UKR"], population: 11, annualGdpAnchor: 101 },
];
const residents = [
  {
    characterId: "resident",
    countryId: "RU" as const,
    homeState: "SU_UKR_CHILD",
    homeRegionId: "SU_UKR",
  },
  { characterId: "stays", countryId: "RU" as const, homeState: "CEN", homeRegionId: "CEN" },
];
const playableResidences = [
  { countryId: "RU" as const, stateId: "CEN" },
  { countryId: "PL" as const, stateId: "PL_MAZ" },
];

describe("federation resident choices", () => {
  it("preserves affected characters pending choice and leaves continuing residents alone", () => {
    expect(
      planSuccessionResidency({
        sourceCountryId: "RU",
        territories,
        residents,
        playableResidences,
        choices: {},
      })
    ).toEqual([
      {
        characterId: "resident",
        successorEntityId: "UKR",
        status: "pending-choice",
        formerCountryId: "RU",
        formerHomeState: "SU_UKR_CHILD",
      },
    ]);
  });

  it("accepts an explicit playable destination without changing identity or original nationality", () => {
    expect(
      planSuccessionResidency({
        sourceCountryId: "RU",
        territories,
        residents,
        playableResidences,
        choices: { resident: { countryId: "PL", stateId: "PL_MAZ" } },
      })
    ).toEqual([
      {
        characterId: "resident",
        successorEntityId: "UKR",
        status: "selected",
        formerCountryId: "RU",
        formerHomeState: "SU_UKR_CHILD",
        destination: { countryId: "PL", stateId: "PL_MAZ" },
      },
    ]);
  });

  it("rejects unknown destinations and choices for unaffected characters", () => {
    const base = { sourceCountryId: "RU" as const, territories, residents, playableResidences };
    expect(() =>
      planSuccessionResidency({
        ...base,
        choices: { resident: { countryId: "PL", stateId: "SU_UKR" } },
      })
    ).toThrow("unavailable playable destination");
    expect(() =>
      planSuccessionResidency({
        ...base,
        choices: { stays: { countryId: "RU", stateId: "CEN" } },
      })
    ).toThrow("does not belong to an affected resident");
    expect(() => planSuccessionResidency({ ...base, playableResidences: [], choices: {} })).toThrow(
      "at least one playable destination"
    );
  });
});
