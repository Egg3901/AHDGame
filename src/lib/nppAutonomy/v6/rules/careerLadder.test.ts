import { describe, expect, it } from "vitest";
import { isCareerClimber, pickCareerStep } from "./careerLadder";

describe("NPP engine 6.9 career ladder", () => {
  it("needs both ambition and standing", () => {
    const base = { _id: "a", politicalInfluence: 60, favorability: 60 };
    expect(isCareerClimber({ ...base, personality: { ambition: 80 } })).toBe(true);
    expect(isCareerClimber({ ...base, personality: { ambition: 60 } })).toBe(false);
    expect(
      isCareerClimber({
        _id: "a",
        personality: { ambition: 90 },
        politicalInfluence: 30,
        favorability: 30,
      })
    ).toBe(false);
  });

  it("climbs to the most senior open race above the current seat", () => {
    const seniority: Record<string, number> = {
      stateSenate: 0,
      house: 6,
      senate: 10,
      governor: 17,
    };
    const options = [
      { _id: "1", type: "senate" },
      { _id: "2", type: "governor" },
      { _id: "3", type: "stateSenate" },
    ];
    expect(pickCareerStep(6, options, (o) => seniority[o.type])?._id).toBe("2");
    expect(pickCareerStep(17, options, (o) => seniority[o.type])).toBeNull();
  });
});
