import { describe, expect, it } from "vitest";
import { splitConversionAppropriations } from "./appropriations";
describe("conversion appropriation conservation", () => {
  it("keeps contract encumbrances and divides only free cash", () => {
    const result = splitConversionAppropriations(
      {
        defenseAppropriation: {
          balance: 1000,
          encumbered: 400,
          arrearsRatio: 0.1,
          accruedThroughTurn: 100,
        },
        intelligenceAppropriation: { balance: 500, accruedThroughTurn: 100 },
      },
      0.2,
      100
    );
    expect(result.moved.defenseAppropriation).toEqual({
      balance: 120,
      encumbered: 0,
      arrearsRatio: 0,
      accruedThroughTurn: 100,
    });
    expect(result.kept.defenseAppropriation).toMatchObject({ balance: 880, encumbered: 400 });
    expect(
      result.moved.intelligenceAppropriation.balance +
        result.kept.intelligenceAppropriation!.balance
    ).toBe(500);
  });
  it("starts an unfunded successor without invoking the legacy year-of-cash healer", () => {
    expect(splitConversionAppropriations({}, 0.1, 300).moved.defenseAppropriation).toMatchObject({
      balance: 0,
      accruedThroughTurn: 300,
    });
  });
  it("does not export an existing overdraft", () => {
    const result = splitConversionAppropriations(
      { defenseAppropriation: { balance: -100, accruedThroughTurn: 100, arrearsRatio: 1 } },
      0.1,
      100
    );
    expect(result.kept.defenseAppropriation?.balance).toBe(-100);
    expect(result.moved.defenseAppropriation.balance).toBe(0);
  });
});
