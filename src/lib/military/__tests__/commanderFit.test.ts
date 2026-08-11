import { describe, it, expect } from "vitest";
import { commanderFitFromGeneral } from "../generalsTree";

describe("commanderFitFromGeneral", () => {
  it("rises with level and the number of trained nodes", () => {
    const low = commanderFitFromGeneral({ level: 1, gtraits: [] });
    const high = commanderFitFromGeneral({ level: 3, gtraits: ["ar1", "ar2"] });
    expect(high).toBeGreaterThan(low);
    expect(commanderFitFromGeneral({ level: 2, gtraits: [] })).toBe(66); // 50 + 16
  });

  it("clamps to 40..98", () => {
    expect(commanderFitFromGeneral({ level: 0, gtraits: [] })).toBeGreaterThanOrEqual(40);
    expect(
      commanderFitFromGeneral({ level: 9, gtraits: ["ar1", "ar2", "ar3", "ar4", "ar5"] })
    ).toBeLessThanOrEqual(98);
  });
});
