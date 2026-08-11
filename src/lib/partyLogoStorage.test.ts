import { describe, expect, it } from "vitest";
import {
  getLocalPartyLogoFilenamePrefix,
  getPartyLogoFilename,
  getPartyLogoStoragePrefix,
} from "./partyLogoStorage";

describe("partyLogoStorage", () => {
  it("scopes uploaded logos by country and full sequential id", () => {
    expect(getPartyLogoStoragePrefix("US", 1)).toBe("party-logos/us-1-");
    expect(getPartyLogoStoragePrefix("UK", 1)).toBe("party-logos/uk-1-");
    expect(getPartyLogoStoragePrefix("US", 10)).toBe("party-logos/us-10-");
  });

  it("builds deterministic filenames without prefix collisions", () => {
    expect(getPartyLogoFilename("US", 1, 12345, "png")).toBe("party-logos/us-1-12345.png");
    expect(getLocalPartyLogoFilenamePrefix("US", 1)).toBe("us-1-");
    expect(getLocalPartyLogoFilenamePrefix("US", 10)).toBe("us-10-");
  });

  it("canonicalizes padded sequential ids to the same storage key", () => {
    expect(getPartyLogoStoragePrefix("US", "01")).toBe("party-logos/us-1-");
    expect(getPartyLogoFilename("US", "001", 12345, "png")).toBe("party-logos/us-1-12345.png");
    expect(getLocalPartyLogoFilenamePrefix("US", "0001")).toBe("us-1-");
  });
});
