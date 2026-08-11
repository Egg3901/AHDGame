import { describe, it, expect } from "vitest";

describe("IE legislature page registration", () => {
  it("exports IEOireachtasPage as a named component", async () => {
    const mod = await import("./IEOireachtasPage");
    expect(mod.IEOireachtasPage).toBeDefined();
    expect(typeof mod.IEOireachtasPage).toBe("function");
  });

  it("LegislatureClient.tsx imports without error after IE registration", async () => {
    // Importing the client module would fail at module-load time if the IE
    // dynamic() import target were unresolvable. Existence confirms the
    // legislature route's module graph is intact.
    const mod = await import("./LegislatureClient");
    expect(mod).toBeDefined();
    expect(typeof mod.default).toBe("function");
  });
});
