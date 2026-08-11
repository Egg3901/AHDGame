import { describe, expect, it } from "vitest";
import type { CareerEvent } from "@/lib/db/types";
import {
  getExecutiveTermLimit,
  getExecutiveTermsServed,
  hasReachedExecutiveTermLimit,
  incrementExecutiveTermsServedUpdate,
} from "./executiveTermLimits";

const legacyPresidentHistory: CareerEvent[] = [
  {
    type: "elected",
    office: { type: "president" },
    officeLabel: "President",
    date: new Date(),
  },
  {
    type: "appointed",
    office: { type: "president" },
    officeLabel: "President",
    date: new Date(),
  },
];

describe("executiveTermLimits", () => {
  it("reads the configured US executive term limit", () => {
    expect(getExecutiveTermLimit("US")).toBe(2);
    expect(getExecutiveTermLimit("UK")).toBeNull();
  });

  it("treats missing stored terms as zero", () => {
    expect(getExecutiveTermsServed({}, "US")).toBe(0);
    expect(hasReachedExecutiveTermLimit({}, "US")).toBe(false);
  });

  it("falls back to presidential career history for legacy characters", () => {
    const legacyCharacter = {
      careerHistory: legacyPresidentHistory,
    };
    expect(getExecutiveTermsServed(legacyCharacter, "US")).toBe(2);
    expect(hasReachedExecutiveTermLimit(legacyCharacter, "US")).toBe(true);
  });

  it("flags characters who have already reached the configured limit", () => {
    const character = { executiveTermsServed: { US: 2 } };
    expect(hasReachedExecutiveTermLimit(character, "US")).toBe(true);
  });

  it("builds the next-term update payload from the higher of stored or historical terms", () => {
    const character = {
      careerHistory: [legacyPresidentHistory[0]],
    };
    expect(incrementExecutiveTermsServedUpdate(character, "US")).toEqual({
      "executiveTermsServed.US": 2,
    });
  });
});

const legacyUachtaranHistory: CareerEvent[] = [
  {
    type: "elected",
    office: { type: "uachtaran" },
    officeLabel: "Uachtarán na hÉireann",
    date: new Date(),
  },
  {
    type: "elected",
    office: { type: "uachtaran" },
    officeLabel: "Uachtarán na hÉireann",
    date: new Date(),
  },
];

describe("executiveTermLimits — Ireland Uachtarán", () => {
  it("reads Ireland's 2-term Uachtarán limit", () => {
    expect(getExecutiveTermLimit("IE")).toBe(2);
  });

  it("counts uachtaran career events toward the IE limit", () => {
    const character = { careerHistory: legacyUachtaranHistory };
    expect(getExecutiveTermsServed(character, "IE")).toBe(2);
    expect(hasReachedExecutiveTermLimit(character, "IE")).toBe(true);
  });

  it("does NOT count president career events toward the IE limit", () => {
    // A character who served two US presidential terms cannot have those terms
    // double-counted against an Irish Uachtarán run.
    const character = { careerHistory: legacyPresidentHistory };
    expect(getExecutiveTermsServed(character, "IE")).toBe(0);
    expect(hasReachedExecutiveTermLimit(character, "IE")).toBe(false);
  });

  it("US regression: presidential terms still counted for US (no drift)", () => {
    const character = { careerHistory: legacyPresidentHistory };
    expect(getExecutiveTermsServed(character, "US")).toBe(2);
    expect(hasReachedExecutiveTermLimit(character, "US")).toBe(true);
  });
});
