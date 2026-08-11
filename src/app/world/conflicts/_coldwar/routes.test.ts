import { describe, expect, it } from "vitest";
import { CW_ROUTES } from "./routes";

describe("Cold War release routes", () => {
  it("does not advertise placeholder command boards", () => {
    // Asserted one route at a time: a single not-arrayContaining over the
    // whole set passes as soon as ANY one is absent, so re-adding one
    // placeholder route would slip through it.
    const routes = Object.values(CW_ROUTES);
    for (const retired of [
      "/world/conflicts/proxy",
      "/world/conflicts/proxy/east",
      "/world/conflicts/moscow-watch",
      "/world/conflicts/washington-watch",
    ]) {
      expect(routes).not.toContain(retired);
    }
  });
});
