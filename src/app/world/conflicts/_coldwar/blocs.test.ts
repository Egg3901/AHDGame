import { describe, it, expect } from "vitest";
import { lookupNation, NATIONS, REG_ORDER, BLOC } from "./blocs";

describe("blocs", () => {
  it("resolves a known nation", () => {
    expect(lookupNation("Russia").name).toBe("Soviet Union");
    expect(lookupNation("United States of America").name).toBe("United States");
  });
  it("falls back to a generic by map bloc for unknown nations", () => {
    const n = lookupNation("Foo", "east");
    expect(n.bloc).toBe("east");
    expect(n.lean).toBe(82);
    const w = lookupNation("Bar", "west");
    expect(w.lean).toBe(22);
  });
  it("register order references seeded nations only", () => {
    expect(REG_ORDER).toHaveLength(9);
    REG_ORDER.forEach((k) => expect(NATIONS[k]).toBeDefined());
  });
  it("bloc palette covers every bloc id", () => {
    (["west", "east", "swing", "other"] as const).forEach((b) => {
      expect(BLOC[b].dot).toMatch(/^#/);
      expect(BLOC[b].label).toBeTruthy();
    });
  });
});
