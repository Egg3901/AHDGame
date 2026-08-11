import { describe, it, expect } from "vitest";
import { parseCountryParam } from "./partyLookup";

describe("parseCountryParam", () => {
  it("accepts the static countries, case-insensitively", () => {
    expect(parseCountryParam("us")).toBe("US");
    expect(parseCountryParam("UK")).toBe("UK");
    expect(parseCountryParam("Jp")).toBe("JP");
  });

  it("accepts runtime-activated seceded countries (SCO/WAL)", () => {
    // Otherwise the logo route drops a seceded party's ?country= and matches by
    // sequentialId against the wrong country (US Republican/Democrat emblems).
    expect(parseCountryParam("sco")).toBe("SCO");
    expect(parseCountryParam("WAL")).toBe("WAL");
  });

  it("rejects unknown values and null", () => {
    expect(parseCountryParam("zz")).toBeNull();
    expect(parseCountryParam("")).toBeNull();
    expect(parseCountryParam(null)).toBeNull();
  });
});
