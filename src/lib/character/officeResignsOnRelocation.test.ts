import { describe, expect, it } from "vitest";
import {
  officeHasStateResidency,
  officeResignsOnRelocation,
} from "./officeResignsOnRelocation";

describe("officeHasStateResidency", () => {
  it("is true for house/senate/governor stamped with a state", () => {
    expect(officeHasStateResidency({ type: "house", state: "CA", seatsHeld: 1 })).toBe(true);
    expect(officeHasStateResidency({ type: "senate", state: "TX", senateClass: 1 })).toBe(true);
    expect(officeHasStateResidency({ type: "governor", state: "NY" })).toBe(true);
  });

  it("is false for country-scoped offices", () => {
    expect(officeHasStateResidency({ type: "vicePresident" })).toBe(false);
    expect(officeHasStateResidency({ type: "president" })).toBe(false);
    expect(officeHasStateResidency({ type: "usCabinet", positionId: "secretary_of_state" })).toBe(
      false
    );
    expect(officeHasStateResidency({ type: "chancellor" })).toBe(false);
  });

  it("is false for null/undefined", () => {
    expect(officeHasStateResidency(null)).toBe(false);
    expect(officeHasStateResidency(undefined)).toBe(false);
  });
});

describe("officeResignsOnRelocation", () => {
  it("always resigns on country change", () => {
    expect(officeResignsOnRelocation({ type: "vicePresident" }, true)).toBe(true);
    expect(officeResignsOnRelocation({ type: "house", state: "CA", seatsHeld: 1 }, true)).toBe(
      true
    );
  });

  it("resigns state-bound offices on same-country move", () => {
    expect(
      officeResignsOnRelocation({ type: "house", state: "CA", seatsHeld: 1 }, false)
    ).toBe(true);
  });

  it("keeps country-scoped offices on same-country move", () => {
    expect(officeResignsOnRelocation({ type: "vicePresident" }, false)).toBe(false);
    expect(officeResignsOnRelocation({ type: "president" }, false)).toBe(false);
  });

  it("is false when there is no office", () => {
    expect(officeResignsOnRelocation(null, false)).toBe(false);
    expect(officeResignsOnRelocation(null, true)).toBe(false);
  });
});
