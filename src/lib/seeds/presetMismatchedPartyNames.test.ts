import { expect, it } from "vitest";
import { presetMismatchedPartyNames, selectPartyRosterForPreset } from "./ensureDefaultParties";
import { frParties } from "./fr/frParties";
import { itParties } from "./it/itParties";
import { esParties } from "./es/esParties";
import { seParties } from "./se/seParties";
import { trParties } from "./tr/trParties";
import { csParties } from "./cs/csParties";
import { ukParties } from "./uk/ukParties";

it("preserves each selected 2019 fallback while deleting stale and absent rosters", () => {
  const countries = new Set(["FR", "IT", "ES", "SE", "TR", "UK"]);
  const rows = [
    ...frParties,
    ...itParties,
    ...esParties,
    ...seParties,
    ...trParties,
    ...ukParties,
    ...csParties,
  ];
  const removed = new Set(
    presetMismatchedPartyNames(rows, "2019-default", countries).map(
      (p) => `${p.countryId}:${p.name}`
    )
  );
  for (const roster of [frParties, itParties, esParties, seParties, trParties, ukParties]) {
    const selected = selectPartyRosterForPreset(roster, "2019-default");
    expect(selected.length).toBeGreaterThan(0);
    for (const party of selected)
      expect(removed.has(`${party.countryId}:${party.name}`)).toBe(false);
  }
  for (const party of csParties.filter(
    (p) => p.validForPresets && !p.validForPresets.includes("2019-default")
  )) {
    expect(removed.has(`${party.countryId}:${party.name}`)).toBe(true);
  }
  const staleUk = ukParties.filter(
    (p) =>
      p.validForPresets?.includes("1991-default") && !p.validForPresets.includes("2019-default")
  );
  expect(staleUk.length).toBeGreaterThan(0);
  for (const party of staleUk) expect(removed.has(`${party.countryId}:${party.name}`)).toBe(true);
});
