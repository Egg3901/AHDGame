import { describe, expect, it } from "vitest";
import {
  editorialFavorabilityNudge,
  editorialAudienceFavorabilityNudge,
  mediaAudienceFit,
  normalizeEditorialPosition,
} from "./rules";

describe("media editorial rules", () => {
  it("dual-reads missing and malformed positions as neutral within the axis bounds", () => {
    expect(normalizeEditorialPosition()).toEqual({ economic: 0, social: 0 });
    expect(normalizeEditorialPosition({ economic: 99, social: Number.NaN })).toEqual({
      economic: 5,
      social: 0,
    });
  });

  it("reduces the actual available audience by at most 25 percent", () => {
    expect(mediaAudienceFit({ economic: 5, social: 5 }, { economic: 5, social: 5 })).toBe(1);
    expect(mediaAudienceFit({ economic: 5, social: 5 }, { economic: -5, social: -5 })).toBe(0.75);
  });

  it("rewards aligned politicians by local share and stays within the half-point cap", () => {
    expect(
      editorialFavorabilityNudge({ economic: 2, social: -1 }, { economic: 2, social: -1 }, 1)
    ).toBe(0.5);
    expect(
      editorialFavorabilityNudge({ economic: 5, social: 5 }, { economic: -5, social: -5 }, 1)
    ).toBe(0);
    expect(
      editorialFavorabilityNudge({ economic: 0, social: 0 }, { economic: 0, social: 0 }, 0.2)
    ).toBe(0.1);
  });

  it("reduces an aligned outlet's effect when another local outlet competes", () => {
    const aligned = { economic: 2, social: -1 };
    expect(
      editorialAudienceFavorabilityNudge([{ stance: aligned, audienceShare: 1 }], aligned)
    ).toBe(0.5);
    expect(
      editorialAudienceFavorabilityNudge(
        [
          { stance: aligned, audienceShare: 0.5 },
          { stance: { economic: -5, social: 5 }, audienceShare: 0.5 },
        ],
        aligned
      )
    ).toBe(0.25);
  });
});
