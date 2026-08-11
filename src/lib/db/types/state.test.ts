import { describe, it, expect } from "vitest";
import type { State } from "./state";

describe("State Type", () => {
  it("should require countryId field", () => {
    // @ts-expect-error countryId is required
    const _invalidState: State = {
      _id: "CA",
      name: "California",
      population: 39_500_000,
      gdp: 3_400_000_000_000,
      houseDistricts: 52,
      stateSenateSeats: 40,
      region: "West",
      // Missing countryId should cause TypeScript error
    };

    // Valid state with countryId
    const validState: State = {
      _id: "CA",
      countryId: "US",
      name: "California",
      population: 39_500_000,
      gdp: 3_400_000_000_000,
      houseDistricts: 52,
      stateSenateSeats: 40,
      region: "West",
    };

    expect(validState.countryId).toBe("US");
  });
});
