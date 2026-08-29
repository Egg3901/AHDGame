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

  it("is directional: the reverse pair has no table", () => {
    expect(officeRemapFor("DE", "DD")).toBeNull();
  });
});
