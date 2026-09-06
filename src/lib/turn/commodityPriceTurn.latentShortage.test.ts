import { describe, expect, it } from "vitest";
import { latentShortageFields } from "./commodityPriceTurn";

describe("latentShortageFields (#1460)", () => {
  it("is empty when nothing was truncated", () => {
    expect(latentShortageFields({ supply: 100, demand: 150 }, undefined)).toEqual({});
    expect(latentShortageFields({ supply: 100, demand: 150 }, 0)).toEqual({});
  });

  it("reports the truncated units and the latent multiple over supply", () => {
    // Capped at 1.5x supply with 350 more units of demand hidden: the world is
    // 5x short, not 1.5x.
    expect(latentShortageFields({ supply: 100, demand: 150 }, 350)).toEqual({
      demandTruncatedUnits: 350,
      latentShortageMultiple: 5,
    });
  });

  it("omits the multiple when there is no supply to divide by", () => {
    expect(latentShortageFields({ supply: 0, demand: 0 }, 42)).toEqual({
      demandTruncatedUnits: 42,
    });
  });
});
