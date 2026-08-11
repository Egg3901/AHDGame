import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_META,
  alignmentBand,
  compassDistance,
  ideologyLabel,
  nearestParty,
} from "./alignment";

describe("compassDistance", () => {
  it("is zero for identical positions", () => {
    expect(compassDistance({ economic: 2, social: -1 }, { economic: 2, social: -1 })).toBe(0);
  });

  it("measures both axes", () => {
    expect(compassDistance({ economic: 0, social: 0 }, { economic: 3, social: 4 })).toBe(5);
  });
});

describe("alignmentBand", () => {
  it("bands by distance", () => {
    expect(alignmentBand(0)).toBe("aligned");
    expect(alignmentBand(1.4)).toBe("aligned");
    expect(alignmentBand(1.5)).toBe("close");
    expect(alignmentBand(2.9)).toBe("close");
    expect(alignmentBand(3)).toBe("daylight");
    expect(alignmentBand(5.4)).toBe("daylight");
    expect(alignmentBand(5.5)).toBe("at-odds");
  });

  it("has display metadata for every band", () => {
    for (const d of [0, 2, 4, 9]) {
      expect(ALIGNMENT_META[alignmentBand(d)].label).toBeTruthy();
    }
  });
});

describe("nearestParty", () => {
  const spd = { id: "1", economic: -2, social: -2 };
  const cdu = { id: "2", economic: 2, social: 1 };

  it("returns null when no party carries a position", () => {
    expect(nearestParty({ economic: 0, social: 0 }, [])).toBeNull();
  });

  it("picks the closest platform and reports its band", () => {
    const result = nearestParty({ economic: -2, social: -2 }, [spd, cdu]);
    expect(result?.party.id).toBe("1");
    expect(result?.distance).toBe(0);
    expect(result?.band).toBe("aligned");
  });

  it("prefers the genuinely nearer platform, not list order", () => {
    expect(nearestParty({ economic: 3, social: 2 }, [spd, cdu])?.party.id).toBe("2");
  });
});

describe("ideologyLabel", () => {
  // `getCompassPositionLabel` reads its second axis as authoritarian(−) →
  // libertarian(+), the inverse of the socialPosition ruler. These cases fail
  // if the sign flip in `ideologyLabel` is ever dropped.
  it("names a left, socially liberal candidate as a left archetype", () => {
    expect(ideologyLabel({ economic: -4, social: -3.5 })).toBe("Democratic Socialist");
  });

  it("names a right, socially traditional candidate as a right-populist archetype", () => {
    expect(ideologyLabel({ economic: 3, social: 2.5 })).toBe("Right-Wing Populist");
  });

  it("names a right, socially liberal candidate as a libertarian archetype", () => {
    expect(ideologyLabel({ economic: 3.5, social: -3 })).toBe("Libertarian");
  });

  it("names the origin as centrist", () => {
    expect(ideologyLabel({ economic: 0, social: 0 })).toBe("Centrist");
  });
});
