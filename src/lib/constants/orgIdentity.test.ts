import { describe, it, expect } from "vitest";
import { resolveOrgIdentity, BUILTIN_ORG_IDENTITY } from "./orgIdentity";

describe("resolveOrgIdentity", () => {
  it("returns the fixed palette for built-ins", () => {
    expect(resolveOrgIdentity("UN", false, "United Nations", "political").accent).toBe("#5b92e5");
    expect(resolveOrgIdentity("NATO", false, "NATO", "security")).toEqual(
      BUILTIN_ORG_IDENTITY.NATO
    );
    expect(resolveOrgIdentity("EU", false, "European Union", "economic").glyph).toBe("★");
  });

  it("gives the Non-Aligned Movement its own palette and local emblem", () => {
    const nam = resolveOrgIdentity("NON_ALIGNED", false, "Non-Aligned Movement", "political");
    expect(nam.accent).toBe("#7a5ea8");
    expect(nam.logoSrc).toBe("/orgs/non-aligned-movement.svg");
    expect(nam.founded).toBe(1961);
    expect(nam.hq).toBe("Belgrade");
  });

  it("derives a deterministic accent for custom orgs", () => {
    const a = resolveOrgIdentity("pacific-pact", true, "Pacific Pact", "economic");
    const b = resolveOrgIdentity("pacific-pact", true, "Pacific Pact", "economic");
    expect(a).toEqual(b);
    expect(a.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gives different custom slugs different accents", () => {
    const a = resolveOrgIdentity("pacific-pact", true, "Pacific Pact", "economic");
    const b = resolveOrgIdentity("andes-union", true, "Andes Union", "economic");
    expect(a.accent).not.toBe(b.accent);
  });

  it("sets the group label from the category", () => {
    expect(resolveOrgIdentity("andes-union", true, "andes union", "development").glyph).toBe("A");
    expect(resolveOrgIdentity("andes-union", true, "andes union", "development").group).toBe(
      "Development"
    );
  });

  it("gives built-ins a fixed emblem logo", () => {
    expect(resolveOrgIdentity("UN", false, "United Nations", "political").logoSrc).toContain(
      "upload.wikimedia.org"
    );
  });

  it("uses a custom org's uploaded logo when provided, else falls back to the glyph", () => {
    expect(
      resolveOrgIdentity(
        "eap",
        true,
        "East Asia Pact",
        "economic",
        "/api/uploads/org-logos/eap.png"
      ).logoSrc
    ).toBe("/api/uploads/org-logos/eap.png");
    expect(resolveOrgIdentity("eap", true, "East Asia Pact", "economic").logoSrc).toBeUndefined();
  });
});
