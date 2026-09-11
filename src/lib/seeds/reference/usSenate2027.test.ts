import { describe, expect, it } from "vitest";
import { SENATE_CLASSES_BY_STATE } from "@/lib/constants/states";
import { US_CONGRESS_PROJECTION_2027 } from "./usCongressProjection2027";
import { US_SENATE_2027 } from "./usSenate2027";

describe("US_SENATE_2027", () => {
  it("matches the frozen 50-50 aligned projection", () => {
    const democrats = US_SENATE_2027.filter((seat) => seat.party === "democrat").length;
    const independents = US_SENATE_2027.filter((seat) => seat.party === "independent").length;
    const republicans = US_SENATE_2027.filter((seat) => seat.party === "republican").length;

    expect(democrats).toBe(48);
    expect(independents).toBe(2);
    expect(democrats + independents).toBe(US_CONGRESS_PROJECTION_2027.senate.democraticAligned);
    expect(republicans).toBe(US_CONGRESS_PROJECTION_2027.senate.republican);
  });

  it("fills each state's canonical Senate classes exactly once", () => {
    expect(US_SENATE_2027).toHaveLength(100);

    for (const [state, expectedClasses] of Object.entries(SENATE_CLASSES_BY_STATE)) {
      const actualClasses = US_SENATE_2027.filter((seat) => seat.state === state)
        .map((seat) => seat.senateClass)
        .sort();
      expect(actualClasses, state).toEqual([...expectedClasses].sort());
    }
  });

  it("keeps the two Democratic-aligned independents in Class 1", () => {
    expect(US_SENATE_2027.filter((seat) => seat.party === "independent")).toEqual([
      { state: "ME", officeType: "senate", party: "independent", senateClass: 1 },
      { state: "VT", officeType: "senate", party: "independent", senateClass: 1 },
    ]);
  });

  it("contains only Senate rows without aggregate seat counts", () => {
    expect(US_SENATE_2027.every((seat) => seat.officeType === "senate")).toBe(true);
    expect(US_SENATE_2027.every((seat) => seat.seatsHeld == null)).toBe(true);
  });
});
