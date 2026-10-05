import { describe, expect, it } from "vitest";
import { chooseNppCorporationName } from "./rules";

describe("NPP corporation brands", () => {
  it("uses local and industry-specific brands", () => {
    expect(chooseNppCorporationName("US", "energy", [], () => 0)).toBe("Copperline Power Company");
    expect(chooseNppCorporationName("UK", "media", [], () => 0)).toBe(
      "Kestrel Yard Press & Signal"
    );
    expect(chooseNppCorporationName("JP", "technology", [], () => 0)).toBe("Aobane Logic Works");
  });
  it("stays unique under repeated RNG draws and an exhausted pool", () => {
    const names: string[] = [];
    for (let i = 0; i < 40; i++)
      names.push(chooseNppCorporationName("US", "energy", names, () => 0));
    expect(new Set(names).size).toBe(40);
    expect(
      chooseNppCorporationName("US", "energy", [" COPPERLINE POWER COMPANY "], () => 0)
    ).not.toBe(names[0]);
  });
});
