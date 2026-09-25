import { describe, expect, it } from "vitest";
import { CS_1991_POPULATION, CS_1991_REGION_POPULATION } from "./csPopulation1991";

describe("Czechoslovakia 1991 census population", () => {
  it("matches the Czech source's rounded total and the Slovak exact total", () => {
    expect(
      CS_1991_REGION_POPULATION.CS_PRG +
        CS_1991_REGION_POPULATION.CS_BOH +
        CS_1991_REGION_POPULATION.CS_MOR
    ).toBe(10_302_200);
    expect(CS_1991_REGION_POPULATION.CS_SVK).toBe(5_274_335);
    expect(CS_1991_POPULATION).toBe(15_576_535);
  });
});
