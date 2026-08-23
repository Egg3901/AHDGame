import { describe, it, expect } from "vitest";
import { blocOf, sharesBloc, type BlocLookup } from "../bloc";

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

describe("sharesBloc", () => {
  it("sees two members of the same alliance", () => {
    expect(sharesBloc(LOOKUP, "US", "UK")).toBe(true);
    expect(sharesBloc(LOOKUP, "RU", "DD")).toBe(true);
  });

  it("does not bar countries on opposite sides", () => {
    expect(sharesBloc(LOOKUP, "US", "RU")).toBe(false);
    expect(sharesBloc(LOOKUP, "DD", "UK")).toBe(false);
  });

  // Non-alignment is the absence of a treaty, not a treaty of its own. 1991, 2019 and
  // 2023 carry NATO with no eastern counterpart, so RU and CN read non-aligned there —
  // barring that pair would make every modern-era war impossible to declare.
  it("never treats two non-aligned countries as allies", () => {
    expect(sharesBloc(LOOKUP, "SE", "CN")).toBe(false);
    expect(sharesBloc({}, "US", "RU")).toBe(false);
  });

  it("does not ally an aligned country with an unrostered one", () => {
    expect(sharesBloc(LOOKUP, "US", "SE")).toBe(false);
    expect(sharesBloc(LOOKUP, "SE", "US")).toBe(false);
  });

  it("is symmetric", () => {
    expect(sharesBloc(LOOKUP, "UK", "US")).toBe(sharesBloc(LOOKUP, "US", "UK"));
  });
});
