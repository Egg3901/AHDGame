import { describe, expect, it } from "vitest";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { BASE_DEMAND } from "@/lib/sovereignDefault/constants";
import { planPublicFloatNovation } from "./publicFloatNovation";

const base = {
  sourceUnits: 100,
  sourceCurrency: "USD",
  replacementCurrency: "USD",
  sourceFacePerUnitLocal: BOND_UNIT_FACE_VALUE,
  replacementPricePerUnitLocal: BOND_UNIT_FACE_VALUE,
  appetite: BASE_DEMAND,
  maturityTurns: 96,
} as const;

describe("planPublicFloatNovation", () => {
  it("exchanges neutral or stronger appetite at par without cash or net principal", () => {
    expect(planPublicFloatNovation(base)).toEqual({
      acceptedUnits: 100,
      faceLocal: 100_000,
      treasuryCashDelta: 0,
      poolCashDelta: 0,
      debtPrincipalDelta: 0,
    });
    expect(planPublicFloatNovation({ ...base, appetite: BASE_DEMAND * 2 }).acceptedUnits).toBe(100);
  });

  it("caps weak appetite to an integer accepted share of the old pool units", () => {
    expect(planPublicFloatNovation({ ...base, appetite: BASE_DEMAND * 0.375 })).toMatchObject({
      acceptedUnits: 37,
      faceLocal: 37_000,
      treasuryCashDelta: 0,
      poolCashDelta: 0,
      debtPrincipalDelta: 0,
    });
  });

  it.each([
    [{ ...base, appetite: 0 }, "no_appetite"],
    [{ ...base, appetite: Number.NaN }, "no_appetite"],
    [{ ...base, sourceCurrency: "GBP" }, "currency_mismatch"],
    [{ ...base, replacementPricePerUnitLocal: BOND_UNIT_FACE_VALUE + 1 }, "non_par_quote"],
    [{ ...base, sourceFacePerUnitLocal: 999 }, "invalid_quote"],
    [{ ...base, sourceHaircutPercent: 0.25 }, "source_restructured"],
    [{ ...base, maturityTurns: 120 }, "invalid_maturity"],
    [{ ...base, sourceUnits: 0 }, "no_source_units"],
  ] as const)("refuses %s", (input, refusal) => {
    expect(planPublicFloatNovation(input)).toMatchObject({
      acceptedUnits: 0,
      faceLocal: 0,
      refusal,
    });
  });

  it("rejects fractional source units and invalid replacement currency", () => {
    expect(planPublicFloatNovation({ ...base, sourceUnits: 1.5 })).toMatchObject({
      acceptedUnits: 0,
      refusal: "no_source_units",
    });
    expect(planPublicFloatNovation({ ...base, replacementCurrency: " " })).toMatchObject({
      acceptedUnits: 0,
      refusal: "invalid_quote",
    });
  });
});
