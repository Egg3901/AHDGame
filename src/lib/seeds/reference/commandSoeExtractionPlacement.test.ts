import { describe, expect, it } from "vitest";
import { generateCountryOwnedSeedData } from "./budgets";

/**
 * Ticket #1271. German reunification kept DD as the surviving country id and
 * re-keyed the eleven western Laender onto it. The command-economy SOE rebuild
 * then placed sixteen of the seventeen sector types across all sixteen states
 * and ZERO extraction plants in the west, because extraction is the one sector
 * gated on a `${countryId}:${stateId}` lookup into the seed capacity table,
 * where those states are still filed under DE. The Ruhr and Saar coal and iron
 * went unreachable: no sector to mine them, and no unowned market either.
 */
const WEST: { id: string; population: number; gdp: number; countryId: string }[] = [
  { id: "NW", population: 15_000_000, gdp: 60_000_000_000, countryId: "DD" },
  { id: "SL", population: 1_000_000, gdp: 4_000_000_000, countryId: "DD" },
  { id: "NI", population: 6_500_000, gdp: 24_000_000_000, countryId: "DD" },
  { id: "SH", population: 2_300_000, gdp: 8_000_000_000, countryId: "DD" },
  { id: "BY", population: 9_000_000, gdp: 32_000_000_000, countryId: "DD" },
];
const EAST = [{ id: "SN", population: 5_500_000, gdp: 12_000_000_000, countryId: "DD" }];

function extractionStates(states: typeof WEST): string[] {
  const entries = generateCountryOwnedSeedData(states, "1953-default", true).filter(
    (e) => e.corporation.countryOwnerId === "DD" && e.corporation.soe
  );
  const extraction = entries.find((e) => e.corporation.assignedSectorTypes?.[0] === "extraction");
  return (extraction?.sectors ?? []).map((s) => s.stateId).sort();
}

describe("command-economy SOE extraction placement after a country merge", () => {
  it("places extraction plants in western Laender absorbed into DD", () => {
    expect(extractionStates(WEST)).toEqual(["BY", "NI", "NW", "SH", "SL"]);
  });

  it("still places them in the eastern Laender it always covered", () => {
    expect(extractionStates(EAST)).toEqual(["SN"]);
  });

  it("gives extraction the same state coverage as every other SOE sector", () => {
    const states = [...WEST, ...EAST];
    const entries = generateCountryOwnedSeedData(states, "1953-default", true).filter(
      (e) => e.corporation.countryOwnerId === "DD" && e.corporation.soe
    );
    expect(entries.length).toBeGreaterThan(1);
    for (const entry of entries) {
      expect(
        entry.sectors.length,
        `${entry.corporation.assignedSectorTypes?.[0]} should cover every state`
      ).toBe(states.length);
    }
  });
});
