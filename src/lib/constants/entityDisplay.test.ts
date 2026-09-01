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

  // Unicode has no GDR flag, and 🇩🇪 is West Germany's — using it made the GDR
  // render as "DE" on every platform that shows an unassigned regional-indicator
  // pair as its letters. 🇩🇩 has no glyph either, so it renders as "DD": the
  // country's own code, which is the same trick the USSR's 🇸🇺 already relies on.
  it("does not give East Germany West Germany's flag", () => {
    expect(entityFlag("DD")).not.toBe(entityFlag("DE"));
  });

  it("encodes East Germany as its own regional-indicator pair", () => {
    expect(entityFlag("DD")).toBe("🇩🇩");
    expect(entityFlag("DE")).toBe("🇩🇪");
  });
});
