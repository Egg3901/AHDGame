import { describe, expect, it } from "vitest";
import { formationTurnToLarpDate } from "./formationDate";

describe("formationTurnToLarpDate", () => {
  it("uses the active world's era and removes pre-iteration turns", () => {
    // Production ticket #1168: raw turn 73 in a 1953 world with a 48-turn founding phase
    // rendered through the global 2019 default as July 2020. Its display turn is actually 25.
    expect(
      formationTurnToLarpDate(73, {
        startingYear: 1953,
        preIterationTurns: 48,
      })
    ).toBe("July, Week 1, 1953");
  });

  it("preserves normal worlds without a pre-iteration offset", () => {
    expect(formationTurnToLarpDate(49, { startingYear: 1991 })).toBe("January, Week 1, 1992");
  });
});
