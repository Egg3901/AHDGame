import { describe, expect, it } from "vitest";
import { presenceBuiltThisTurn } from "./presenceBuiltThisTurn";
describe("presence built this turn", () => {
  const boundary = new Date("2026-01-01T12:00:00Z");
  it("includes the exact turn boundary and subsequent builds", () => {
    expect(presenceBuiltThisTurn(boundary, boundary)).toBe(true);
    expect(presenceBuiltThisTurn("2026-01-01T12:01:00Z", boundary)).toBe(true);
  });
  it("clears previous-turn builds and handles missing timestamps", () => {
    expect(presenceBuiltThisTurn("2026-01-01T11:59:59Z", boundary)).toBe(false);
    expect(presenceBuiltThisTurn(null, boundary)).toBe(false);
    expect(presenceBuiltThisTurn(undefined, boundary)).toBe(false);
  });
});
