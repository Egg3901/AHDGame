import { describe, expect, it } from "vitest";
import { getNationalPartyTransferTargets } from "./transferTargets";
import { COUNTRY_CONFIGS } from "./countries";

describe("getNationalPartyTransferTargets", () => {
  it("returns 50 US states for US", () => {
    const rows = getNationalPartyTransferTargets(COUNTRY_CONFIGS.US.id);
    expect(rows).toHaveLength(50);
    expect(rows[0]).toEqual(["AL", "Alabama"]);
  });

  it("returns UK NUTS1-style regions for UK", () => {
    const rows = getNationalPartyTransferTargets(COUNTRY_CONFIGS.UK.id);
    expect(rows.some(([id]) => id === "LON")).toBe(true);
    expect(rows.some(([id]) => id === "SEE")).toBe(true);
  });

  it("returns Japan game regions for JP", () => {
    const rows = getNationalPartyTransferTargets(COUNTRY_CONFIGS.JP.id);
    expect(rows).toHaveLength(8);
    expect(rows.map(([id]) => id).sort()).toEqual(
      ["CGK", "CHU", "HOK", "KAN", "KNS", "KYU", "SHI", "TOH"].sort()
    );
  });

  it("returns Ireland NUTS-III regions for IE", () => {
    const rows = getNationalPartyTransferTargets(COUNTRY_CONFIGS.IE.id);
    expect(rows).toHaveLength(8);
    expect(rows.some(([id]) => id === "DUB")).toBe(true);
    expect(rows.some(([id]) => id === "GAL")).toBe(true);
  });

  it("returns China macro-regions for CN", () => {
    const rows = getNationalPartyTransferTargets(COUNTRY_CONFIGS.CN.id);
    expect(rows).toHaveLength(7);
    expect(rows.map(([id]) => id).sort()).toEqual(
      ["DB", "HB", "HD", "HN", "HZ", "XB", "XN"].sort()
    );
    expect(rows.find(([id]) => id === "HD")).toEqual(["HD", "Huadong"]);
  });

  it("returns empty for countries without national→regional transfers yet", () => {
    expect(getNationalPartyTransferTargets(COUNTRY_CONFIGS.DE.id)).toEqual([]);
  });
});
