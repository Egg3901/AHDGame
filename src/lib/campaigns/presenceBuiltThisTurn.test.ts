import { describe, expect, it } from "vitest";
import { presenceBuiltThisTurn, presenceSpendThisTurn } from "./presenceBuiltThisTurn";
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

it("shows actual recorded funds only for a current-turn build receipt", () => {
  const start = new Date("2026-01-01T12:00:00Z");
  expect(presenceSpendThisTurn({ lastBuildAt: start, lastBuildFunds: 123_456 }, start)).toBe(
    123_456
  );
  expect(
    presenceSpendThisTurn(
      { lastBuildAt: new Date("2026-01-01T11:59:59Z"), lastBuildFunds: 123_456 },
      start
    )
  ).toBeNull();
  expect(presenceSpendThisTurn({ lastBuildFunds: 123_456 }, start)).toBeNull();
  expect(presenceSpendThisTurn({ lastBuildAt: start }, start)).toBeNull();
});
