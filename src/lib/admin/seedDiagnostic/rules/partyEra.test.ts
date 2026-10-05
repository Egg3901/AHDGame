import { describe, expect, it } from "vitest";
import { wrongEraDefaultParties } from "./partyEra";

const roster = new Map([["IT", new Set(["Fratelli d'Italia", "Partito Democratico"])]]);

describe("wrongEraDefaultParties", () => {
  it("flags a dissolved party in a country with an authored roster", () => {
    const bad = wrongEraDefaultParties(
      [
        { countryId: "IT", name: "Democrazia Cristiana" },
        { countryId: "IT", name: "Partito Democratico" },
      ],
      roster
    );
    expect(bad).toEqual([{ countryId: "IT", name: "Democrazia Cristiana" }]);
  });

  it("ignores countries with no effective roster to compare against", () => {
    expect(wrongEraDefaultParties([{ countryId: "ZZ", name: "Anything" }], roster)).toEqual([]);
  });
});
