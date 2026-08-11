import { describe, it, expect } from "vitest";
import { nationalOfficeTypes, officeLabel } from "@/lib/api/discordBotLabels";

describe("government route country support", () => {
  it("supports every country the old hardcoded map covered", () => {
    for (const c of ["US", "UK", "DE", "JP", "IE", "CN"] as const) {
      expect(nationalOfficeTypes(c).length).toBeGreaterThan(0);
    }
  });

  it("supports countries the old map omitted, including RU and DD", () => {
    for (const c of ["BR", "NG", "RU", "DD"] as const) {
      expect(nationalOfficeTypes(c).length).toBeGreaterThan(0);
    }
  });

  it("labels one-party executives from config", () => {
    expect(officeLabel("RU", "premier")).toBe("Premier");
    expect(officeLabel("RU", "chairmanOfPresidium")).toBe("Chairman of the Presidium");
    expect(officeLabel("DD", "generalSecretary")).toBe("General Secretary");
  });

  /*
   * These strings were previously produced by a hardcoded ternary chain in
   * route.ts. Pinned here so a config label edit that would silently change
   * the bot's /government output fails loudly instead.
   */
  it("reproduces the labels the removed ternary chain emitted", () => {
    expect(officeLabel("US", "president")).toBe("President");
    expect(officeLabel("US", "vicePresident")).toBe("Vice President");
    expect(officeLabel("UK", "primeMinister")).toBe("Prime Minister");
    expect(officeLabel("JP", "primeMinister")).toBe("Prime Minister");
    expect(officeLabel("DE", "chancellor")).toBe("Chancellor");
    expect(officeLabel("IE", "taoiseach")).toBe("Taoiseach");
    expect(officeLabel("CN", "premier")).toBe("Premier");
    expect(officeLabel("CN", "president")).toBe("President");
  });

  /*
   * Deliberate divergence from the old ternary, which emitted the long form
   * "Uachtarán na hÉireann". The config label is authoritative now.
   */
  it("shortens the Irish presidency to the config label", () => {
    expect(officeLabel("IE", "uachtaran")).toBe("Uachtarán");
  });
});
