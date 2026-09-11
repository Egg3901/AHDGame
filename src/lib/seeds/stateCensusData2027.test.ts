import { describe, expect, it } from "vitest";

import { states2027 } from "./reference/states2027";
import { stateCensusData2027 } from "./stateCensusData2027";

const COMPOSITION_DIMENSIONS = ["race", "education", "wealth", "age"] as const;

describe("stateCensusData2027", () => {
  it("covers every 2027 US jurisdiction exactly once", () => {
    expect(Object.keys(stateCensusData2027).sort()).toEqual(
      states2027.map((state) => state._id).sort()
    );
  });

  it("contains normalized integer composition shares", () => {
    for (const profile of Object.values(stateCensusData2027)) {
      for (const dimension of COMPOSITION_DIMENSIONS) {
        const shares = Object.values(profile[dimension]);
        expect(shares.every(Number.isInteger)).toBe(true);
        expect(shares.every((share) => share >= 0 && share <= 100)).toBe(true);
        expect(shares.reduce((total, share) => total + share, 0)).toBe(100);
      }
    }
  });

  it("keeps ideology as bounded independent shares", () => {
    for (const profile of Object.values(stateCensusData2027)) {
      expect(Object.keys(profile.ideology).sort()).toEqual(
        [
          "environmentalists",
          "evangelicals",
          "gunowners",
          "libertarians",
          "patriots",
          "progressives",
        ].sort()
      );
      expect(Object.values(profile.ideology).every((share) => share >= 0 && share <= 100)).toBe(
        true
      );
    }
    expect(stateCensusData2027.DC.ideology.progressives).toBeGreaterThan(
      stateCensusData2027.WY.ideology.progressives
    );
    expect(stateCensusData2027.WY.ideology.gunowners).toBeGreaterThan(
      stateCensusData2027.DC.ideology.gunowners
    );
  });
});
