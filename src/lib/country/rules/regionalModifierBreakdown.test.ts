import { describe, expect, it } from "vitest";
import { regionalModifierBreakdown } from "./regionalModifierBreakdown";
const modifier = (id: string, effect: number) => ({ id, label: id, effect });
describe("national named condition breakdown", () => {
  it("weights actual regional conditions and preserves names", () => {
    const result = regionalModifierBreakdown([
      { base: 50, approval: 52, population: 900, modifiers: [modifier("healthy", 2)] },
      { base: 50, approval: 48, population: 100, modifiers: [modifier("crisis", -2)] },
    ]);
    expect(result.map((row) => [row.id, row.effect])).toEqual([
      ["healthy", 1.8],
      ["crisis", -0.2],
    ]);
  });
  it("accounts for positive caps and damping without changing condition strengths", () => {
    const result = regionalModifierBreakdown([
      {
        base: 50,
        approval: 52,
        population: 1,
        modifiers: [modifier("a", 10), modifier("b", 10), modifier("c", -2)],
      },
    ]);
    expect(result.map((row) => [row.id, row.effect])).toEqual([
      ["a", 4],
      ["b", 4],
      ["c", -2],
      ["regional_adjustment", -4],
    ]);
    expect(result.reduce((sum, row) => sum + row.effect, 0)).toBe(2);
  });
  it("ignores nonpositive population and handles an empty country", () => {
    expect(regionalModifierBreakdown([])).toEqual([]);
    expect(
      regionalModifierBreakdown([
        { base: 50, approval: 55, population: 0, modifiers: [modifier("a", 5)] },
        { base: 50, approval: 45, population: -1, modifiers: [modifier("b", -5)] },
      ])
    ).toEqual([]);
    expect(
      regionalModifierBreakdown([
        { base: 50, approval: 55, population: 10, modifiers: [modifier("a", 5)] },
        { base: 50, approval: 0, population: -10, modifiers: [modifier("b", -50)] },
      ])
    ).toEqual([{ ...modifier("a", 5), marginEffect: 0 }]);
  });
});
