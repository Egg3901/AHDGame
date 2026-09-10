import { describe, expect, it } from "vitest";
import { latentShortageFields, latentShortagePersistence } from "./latentShortage";

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

  it("unsets stale diagnostics when a capped commodity becomes uncapped", () => {
    expect(latentShortagePersistence({ supply: 100, demand: 150 }, undefined)).toEqual({
      set: {},
      unset: { demandTruncatedUnits: "", latentShortageMultiple: "" },
    });
  });

  it("keeps truncation but clears a stale multiple when supply reaches zero", () => {
    expect(latentShortagePersistence({ supply: 0, demand: 0 }, 42)).toEqual({
      set: { demandTruncatedUnits: 42 },
      unset: { latentShortageMultiple: "" },
    });
  });
});
