import { describe, it, expect } from "vitest";
import { officeRemapFor, remapOffice } from "./dissolvingOfficeRemap";

describe("dissolvingOfficeRemap", () => {
  it("maps East Germany's chambers onto Germany's", () => {
    expect(remapOffice("DD", "DE", "volkskammerDeputy")).toBe("bundestag");
    expect(remapOffice("DD", "DE", "landAssembly")).toBe("landtag");
    expect(remapOffice("DD", "DE", "governor")).toBe("ministerPresident");
  });

  it("retires an office with no counterpart", () => {
    expect(remapOffice("DD", "DE", "chairmanOfStateCouncil")).toBeNull();
  });

  it("retires an office the table does not name at all", () => {
    expect(remapOffice("DD", "DE", "somethingElse")).toBeNull();
  });

  it("has no table for a pair that does not merge", () => {
    expect(officeRemapFor("UK", "IE")).toBeNull();
    expect(remapOffice("UK", "IE", "house")).toBeNull();
  });

  it("maps the other direction too, for a settlement the GDR survives", () => {
    // Reunification can leave either Germany standing. With the GDR as the shell
    // the currency, government type and party statuses are already right and only
    // the NAME needs an override — the cheaper side of the trade.
    expect(remapOffice("DE", "DD", "bundestag")).toBe("volkskammerDeputy");
    expect(remapOffice("DE", "DD", "landtag")).toBe("landAssembly");
    expect(remapOffice("DE", "DD", "ministerPresident")).toBe("governor");
    expect(remapOffice("DE", "DD", "president")).toBeNull();
  });

  it("round-trips the chambers, so neither direction invents a seat", () => {
    for (const [from, to] of [
      ["volkskammerDeputy", "bundestag"],
      ["landAssembly", "landtag"],
      ["governor", "ministerPresident"],
    ] as const) {
      expect(remapOffice("DD", "DE", from)).toBe(to);
      expect(remapOffice("DE", "DD", to)).toBe(from);
    }
  });
});
