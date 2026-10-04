import { describe, expect, it } from "vitest";
import { marketTurnLabel } from "./calendar";
const calendar = {
  startingYear: 1953,
  currentTurn: 1266,
  lastTurnProcessed: "2026-10-01",
  preIterationTurns: 48,
};
describe("market calendar", () => {
  it("matches the world year after the founding offset", () => {
    expect(marketTurnLabel(1266, calendar, true)).toBe("May 1978 · Week 2 · T1266");
    expect(marketTurnLabel(48, calendar, true)).toBe("Jan 1953 · Founding · T48");
    expect(marketTurnLabel(49, calendar)).toBe("Jan 1953");
  });
  it("does not invent a calendar without world metadata", () => {
    expect(marketTurnLabel(1266, null)).toBe("T1266");
  });
});
