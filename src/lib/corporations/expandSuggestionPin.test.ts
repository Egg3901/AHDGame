import { describe, expect, it } from "vitest";
import { pinStateInTopSuggestions } from "./expandSuggestionPin";

describe("pinStateInTopSuggestions", () => {
  const ranked = [
    { stateId: "CA", demand: 68 },
    { stateId: "NY", demand: 34 },
    { stateId: "PA", demand: 23 },
    { stateId: "IL", demand: 21 },
    { stateId: "OH", demand: 19 },
    { stateId: "MD", demand: 14 },
    { stateId: "VA", demand: 12 },
  ];

  it("returns the ordinary top-N when nothing is pinned", () => {
    expect(pinStateInTopSuggestions(ranked, undefined).map((s) => s.stateId)).toEqual([
      "CA",
      "NY",
      "PA",
      "IL",
      "OH",
    ]);
  });

  it("puts a below-top-N deep-link state first and keeps four peers", () => {
    expect(pinStateInTopSuggestions(ranked, "MD").map((s) => s.stateId)).toEqual([
      "MD",
      "CA",
      "NY",
      "PA",
      "IL",
    ]);
  });

  it("keeps an already-ranked pin first without duplicating it", () => {
    expect(pinStateInTopSuggestions(ranked, "PA").map((s) => s.stateId)).toEqual([
      "PA",
      "CA",
      "NY",
      "IL",
      "OH",
    ]);
  });

  it("ignores an unknown pin and falls back to top-N", () => {
    expect(pinStateInTopSuggestions(ranked, "ZZ").map((s) => s.stateId)).toEqual([
      "CA",
      "NY",
      "PA",
      "IL",
      "OH",
    ]);
  });
});
