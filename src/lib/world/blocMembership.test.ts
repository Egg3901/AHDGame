import { describe, expect, it } from "vitest";
import { rivalBlocOrgsFor } from "./blocMembership";

describe("rivalBlocOrgsFor", () => {
  it("answers the Warsaw Pact for NATO in a Cold War world", () => {
    expect(rivalBlocOrgsFor("1953-default", "NATO")).toEqual(["WARSAW_PACT"]);
  });

  it("answers NATO for the Warsaw Pact", () => {
    expect(rivalBlocOrgsFor("1953-default", "WARSAW_PACT")).toEqual(["NATO"]);
  });

  it("has no opinion about an org that does not govern accession", () => {
    // Joining the UN costs a country nothing it already holds.
    expect(rivalBlocOrgsFor("1953-default", "UN")).toEqual([]);
  });

  it("names no rival where the era has only one accession channel", () => {
    // The Warsaw Pact dissolves in 1991: Moscow and Beijing carry no bloc org
    // after it, so NATO membership excludes nothing.
    expect(rivalBlocOrgsFor("2019-default", "NATO")).toEqual([]);
  });

  it("keys on the preset, never on the live year", () => {
    // A 1953 world still has a Warsaw Pact in its year 2050. Reading the era off
    // the clock instead of the preset would return nothing here the moment a
    // Cold War game passed 1991, and the exclusivity would go silently inert.
    expect(rivalBlocOrgsFor("1953-default", "NATO")).toEqual(["WARSAW_PACT"]);
  });
});
