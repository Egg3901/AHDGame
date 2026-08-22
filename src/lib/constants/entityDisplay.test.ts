import { describe, expect, it } from "vitest";
import { entityFlag, entityName } from "./entityDisplay";

describe("entityName", () => {
  it("uses the playable country config when one exists", () => {
    expect(entityName("US")).toBe("United States");
  });

  it("falls back to the alignment roster for unplayable members", () => {
    expect(entityName("CA")).toBe("Canada");
    expect(entityName("JO")).toBe("Jordan");
    expect(entityName("BE")).toBe("Belgium");
  });

  it("falls back to the id when nothing names the entity", () => {
    expect(entityName("ZZ")).toBe("ZZ");
  });
});

describe("entityFlag", () => {
  it("keeps the authored emoji for playable countries", () => {
    expect(entityFlag("US")).toBe("🇺🇸");
    expect(entityFlag("UK")).toBe("🇬🇧");
  });

  it("encodes two-letter ISO keys as regional-indicator flags", () => {
    expect(entityFlag("CA")).toBe("🇨🇦");
    expect(entityFlag("BE")).toBe("🇧🇪");
    expect(entityFlag("NL")).toBe("🇳🇱");
    expect(entityFlag("JO")).toBe("🇯🇴");
    expect(entityFlag("KR")).toBe("🇰🇷");
  });

  it("keeps the white flag for ids that are not ISO alpha-2", () => {
    expect(entityFlag("NVN")).toBe("🏳️");
    expect(entityFlag("SVN")).toBe("🏳️");
  });
});
