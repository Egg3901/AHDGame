import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS } from "./countries";

describe("US chamber names are de-prefixed", () => {
  it("drops the U.S. prefix", () => {
    expect(COUNTRY_CONFIGS.US.legislature.upperChamber?.name).toBe("Senate");
    expect(COUNTRY_CONFIGS.US.legislature.lowerChamber.name).toBe("House of Representatives");
  });
});
