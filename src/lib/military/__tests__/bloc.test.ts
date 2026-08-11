import { describe, it, expect } from "vitest";
import { blocOf, type BlocLookup } from "../bloc";

// A roll, not a judgment: these are the countries an accession-governing organisation
// actually seats. Everything else is non-aligned.
const LOOKUP: BlocLookup = { US: "west", UK: "west", RU: "east", DD: "east" };

describe("blocOf", () => {
  it("reads a country's bloc from live membership", () => {
    expect(blocOf(LOOKUP, "US")).toBe("west");
    expect(blocOf(LOOKUP, "DD")).toBe("east");
  });

  // The retired COUNTRY_BLOC table defaulted every unknown country to the US row, so 18
  // of 27 country ids silently read as western — the defect that stopped East Germany
  // declaring an offensive on NATO at all.
  it("reads an unlisted country as non-aligned, never as western", () => {
    expect(blocOf(LOOKUP, "SE")).toBe("nonAligned");
    expect(blocOf(LOOKUP, "PL")).toBe("nonAligned");
    expect(blocOf(LOOKUP, "ZZ")).toBe("nonAligned");
  });

  it("treats an empty roll as wholly non-aligned rather than wholly western", () => {
    expect(blocOf({}, "US")).toBe("nonAligned");
  });
});
