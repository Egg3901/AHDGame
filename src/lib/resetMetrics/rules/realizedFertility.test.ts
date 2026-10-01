import { describe, expect, it } from "vitest";
import { computeBirths } from "@/lib/demographics/flows/fertility";
import { realizedTfrFromBirths } from "./realizedFertility";

describe("realized fertility from canonical cohort births", () => {
  const before = {
    male: Array(101).fill(0) as number[],
    female: Array.from({ length: 101 }, (_, age) => (age >= 18 && age <= 44 ? 1_000 : 0)),
  };

  it("recovers the enacted flow TFR and reflects service-reduced births", () => {
    const births = computeBirths(before, 2.1, 48);
    expect(realizedTfrFromBirths(before, births, 48)).toBeCloseTo(2.1);
    const serving = Array(101).fill(0) as number[];
    serving[28] = 500;
    const reducedBirths = computeBirths(before, 2.1, 48, serving);
    expect(realizedTfrFromBirths(before, reducedBirths, 48)).toBeLessThan(2.1);
  });

  it("withholds an observation without eligible female exposure", () => {
    expect(
      realizedTfrFromBirths({ male: Array(101).fill(0), female: Array(101).fill(0) }, 0, 48)
    ).toBeNull();
  });
});
