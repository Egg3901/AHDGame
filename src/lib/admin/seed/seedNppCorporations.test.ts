import { describe, it, expect } from "vitest";
import { nppCorpSpawnPlan } from "./seedNppCorporations";
import type { CountryId } from "@/lib/constants/countries";

describe("nppCorpSpawnPlan (1953-default)", () => {
  const plan = nppCorpSpawnPlan("1953-default", 1953);
  const byId = new Map(plan.map((p) => [p.countryId, p]));

  it("gives player-enabled countries 1 corp per sector", () => {
    expect(byId.get("US")?.perSectorCount).toBe(1);
    expect(byId.get("UK")?.perSectorCount).toBe(1);
  });

  it("gives econ-preview market democracies 2 corps per sector", () => {
    const econPreview: CountryId[] = [
      "DE",
      "JP",
      "IE",
      "BR",
      "NG",
      "FR",
      "IT",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
    ];
    for (const c of econPreview) {
      expect(byId.get(c)?.perSectorCount, `${c} should be 2/sector`).toBe(2);
    }
  });

  it("excludes planned economies (SOEs come from the budget seeders)", () => {
    // The three union republics are planned economies too: their state
    // enterprises come from the budget seeders, not the market-corp spawner.
    const planned: CountryId[] = [
      "RU",
      "CN",
      "DD",
      "PL",
      "HU",
      "CS",
      "RO",
      "BG",
      "YU",
      "UKR",
      "BLR",
      "BAL",
    ];
    for (const c of planned) {
      expect(byId.has(c), `${c} should not spawn market corps`).toBe(false);
    }
  });

  it("assigns every planned country a valid HQ region", () => {
    for (const p of plan) expect(p.hqState.length).toBeGreaterThan(0);
  });

  it("returns [] for a preset with no enablement map", () => {
    expect(nppCorpSpawnPlan("2019-default", 2019)).toEqual([]);
  });
});
