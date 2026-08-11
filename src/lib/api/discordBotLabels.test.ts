import { describe, it, expect } from "vitest";
import { officeLabel, findOfficeLabel, nationalOfficeTypes } from "./discordBotLabels";

describe("officeLabel", () => {
  it("resolves per-country labels from config", () => {
    expect(officeLabel("US", "senate")).toBe("Senator");
    expect(officeLabel("UK", "commons")).toBe("Member of Parliament");
    expect(officeLabel("RU", "supremeSovietDeputy")).toBe("Supreme Soviet Deputy");
    expect(officeLabel("RU", "governor")).toBe("Republic First Secretary");
    expect(officeLabel("DD", "volkskammerDeputy")).toBe("Deputy");
    expect(officeLabel("DD", "governor")).toBe("Land First Secretary");
  });

  it("falls back to the raw key for an unknown office type", () => {
    expect(officeLabel("US", "totallyMadeUp")).toBe("totallyMadeUp");
  });
});

describe("findOfficeLabel", () => {
  it("resolves a real office type", () => {
    expect(findOfficeLabel("RU", "supremeSovietDeputy")).toBe("Supreme Soviet Deputy");
  });

  /*
   * Snap election types are valid Election.electionType values but have no
   * officeType config entry. Returning undefined (not the raw key) is what lets
   * the Discord bot's own formatElectionType map still win for those races —
   * echoing the key back would render "snap_commons" to users.
   */
  it("returns undefined for snap election types that have no office config", () => {
    expect(findOfficeLabel("UK", "snap_commons")).toBeUndefined();
    expect(findOfficeLabel("DE", "snap_bundestag")).toBeUndefined();
    expect(findOfficeLabel("JP", "snap_shugiin")).toBeUndefined();
    expect(findOfficeLabel("IE", "snap_dail")).toBeUndefined();
  });

  it("returns undefined for an unknown country", () => {
    expect(findOfficeLabel("ZZ" as never, "president")).toBeUndefined();
  });
});

describe("nationalOfficeTypes", () => {
  // Pins the derivation against the map it replaces in government/route.ts.
  it("reproduces the previously hardcoded entries", () => {
    expect(nationalOfficeTypes("US")).toEqual(["president", "vicePresident"]);
    expect(nationalOfficeTypes("UK")).toEqual(["primeMinister"]);
    expect(nationalOfficeTypes("DE")).toEqual(["chancellor"]);
    expect(nationalOfficeTypes("JP")).toEqual(["primeMinister"]);
    expect(nationalOfficeTypes("CN")).toEqual(["premier", "president"]);
  });

  it("covers countries the old map omitted", () => {
    expect(nationalOfficeTypes("BR")).toEqual(["president", "vicePresident"]);
    expect(nationalOfficeTypes("NG")).toEqual(["president", "vicePresident"]);
    expect(nationalOfficeTypes("RU")).toEqual(["premier", "chairmanOfPresidium"]);
    // Head of government first, then the ceremonial head of state — the same shape as
    // RU and CN above. DD gained its Council of State chairmanship when the Warsaw
    // Pact states stopped reporting a head of state that did not exist.
    expect(nationalOfficeTypes("DD")).toEqual(["generalSecretary", "chairmanOfStateCouncil"]);
  });

  it("includes the Tánaiste for Ireland (config has three national executives)", () => {
    expect(nationalOfficeTypes("IE")).toEqual(["taoiseach", "tanaiste", "uachtaran"]);
  });
});
