import { describe, expect, it } from "vitest";
import { US_CONGRESS_PROJECTION_2027 } from "./usCongressProjection2027";

describe("US_CONGRESS_PROJECTION_2027", () => {
  it("fills all 435 House seats", () => {
    const { house } = US_CONGRESS_PROJECTION_2027;
    expect(house.democrat + house.republican).toBe(435);
  });

  it("fills all 100 Senate seats", () => {
    const { senate } = US_CONGRESS_PROJECTION_2027;
    expect(senate.democraticAligned + senate.republican).toBe(100);
  });

  it("records Republican tie-break control of the projected 50-50 Senate", () => {
    expect(US_CONGRESS_PROJECTION_2027.senate).toMatchObject({
      democraticAligned: 50,
      republican: 50,
      controllingParty: "republican",
      controlBasis: "vice-presidential tie-break",
    });
  });
});
