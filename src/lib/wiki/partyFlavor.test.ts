import { describe, it, expect } from "vitest";
import { getPartyFlavor } from "./partyFlavor";

describe("getPartyFlavor", () => {
  it("returns UK Labour flavor by name even when id is a sequential string", () => {
    const flavor = getPartyFlavor("1", "Labour Party", "LAB");
    expect(flavor.blurb).toMatch(/NHS/);
    expect(flavor.tips.length).toBeGreaterThanOrEqual(3);
  });

  it("returns Conservative flavor by abbreviation", () => {
    const flavor = getPartyFlavor("99", "Some Alias", "CON");
    expect(flavor.blurb).toMatch(/Conservatives|Union/i);
  });

  it("falls back to generic for unknown parties", () => {
    const flavor = getPartyFlavor("42", "Widget Party");
    expect(flavor.blurb).toMatch(/Widget Party/);
  });
});
